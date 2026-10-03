import { v2 as cloudinaryLib } from 'cloudinary';
import crypto from 'crypto';
import fs from 'fs';
import { ENV, isCloudinaryConfigured } from '../config/env.config';
import { UPLOAD } from '../config/upload.config';
import { AppError } from '../utils/AppError';
import { ERROR } from '../messages/error';
import { ERROR_CODE, HTTP_STATUS } from '../constants/http';
import { logger } from './logger.service';

let initialised = false;

const init = () => {
  if (initialised) return;
  if (!isCloudinaryConfigured) return;
  cloudinaryLib.config({
    cloud_name: ENV.CLOUDINARY_CLOUD_NAME,
    api_key: ENV.CLOUDINARY_API_KEY,
    api_secret: ENV.CLOUDINARY_API_SECRET,
    secure: true,
  });
  initialised = true;
};

export interface UploadedAsset {
  url: string;
  publicId: string;
  width: number;
  height: number;
  format: string;
  bytes: number;
  folder: string;
}

const folderFor = (kind: string): string =>
  `${UPLOAD.CLOUDINARY_FOLDER}/${kind}`.replace(/\/+/g, '/');

/** An empty or blank `folder` means "use the default" — `??` alone would not. */
const resolveFolder = (kind: string, override?: string): string => {
  const trimmed = String(override ?? '').trim();
  return trimmed ? trimmed.replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '') : folderFor(kind);
};

/**
 * Streams a local temp file to Cloudinary and removes it afterwards.
 * Callers must have validated MIME + size via the upload middleware.
 */
export const uploadToCloudinary = async (
  filePath: string,
  kind = 'common',
  options: { publicId?: string; folder?: string; resourceType?: 'image' | 'video' | 'raw' } = {},
): Promise<UploadedAsset> => {
  if (!isCloudinaryConfigured) {
    throw new AppError(
      ERROR.UPLOAD.UPLOAD_FAILED,
      HTTP_STATUS.SERVICE_UNAVAILABLE,
      ERROR_CODE.SERVICE_UNAVAILABLE,
    );
  }

  init();

  try {
    const result = await new Promise<any>((resolve, reject) => {
      const stream = cloudinaryLib.uploader.upload_stream(
        {
          folder: resolveFolder(kind, options.folder),
          public_id: options.publicId,
          resource_type: options.resourceType ?? 'auto',
          overwrite: false,
        },
        (err, res) => (err ? reject(err) : resolve(res)),
      );
      fs.createReadStream(filePath).pipe(stream);
    });

    return {
      url: result.secure_url,
      publicId: result.public_id,
      width: result.width ?? 0,
      height: result.height ?? 0,
      format: result.format ?? '',
      bytes: result.bytes ?? 0,
      folder: result.folder ?? '',
    };
  } catch (err) {
    logger.error({ err: (err as Error)?.message }, '[cloudinary] upload failed');
    throw new AppError(
      ERROR.UPLOAD.UPLOAD_FAILED,
      HTTP_STATUS.SERVICE_UNAVAILABLE,
      ERROR_CODE.SERVICE_UNAVAILABLE,
    );
  } finally {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      /* ignore */
    }
  }
};

export const uploadBufferToCloudinary = async (
  buffer: Buffer,
  kind = 'common',
  options: { publicId?: string; folder?: string } = {},
): Promise<UploadedAsset> => {
  if (!isCloudinaryConfigured) {
    throw new AppError(
      ERROR.UPLOAD.UPLOAD_FAILED,
      HTTP_STATUS.SERVICE_UNAVAILABLE,
      ERROR_CODE.SERVICE_UNAVAILABLE,
    );
  }

  init();

  try {
    const result = await cloudinaryLib.uploader.upload(buffer.toString('base64'), {
      folder: resolveFolder(kind, options.folder),
      public_id: options.publicId,
      resource_type: 'auto',
      overwrite: false,
    });

    return {
      url: result.secure_url,
      publicId: result.public_id,
      width: result.width ?? 0,
      height: result.height ?? 0,
      format: result.format ?? '',
      bytes: result.bytes ?? 0,
      folder: result.folder ?? '',
    };
  } catch (err) {
    logger.error({ err: (err as Error)?.message }, '[cloudinary] buffer upload failed');
    throw new AppError(
      ERROR.UPLOAD.UPLOAD_FAILED,
      HTTP_STATUS.SERVICE_UNAVAILABLE,
      ERROR_CODE.SERVICE_UNAVAILABLE,
    );
  }
};

export const deleteFromCloudinary = async (publicId: string): Promise<boolean> => {
  if (!isCloudinaryConfigured || !publicId) return false;
  init();
  try {
    await cloudinaryLib.uploader.destroy(publicId);
    return true;
  } catch (err) {
    logger.error({ err: (err as Error)?.message, publicId }, '[cloudinary] delete failed');
    return false;
  }
};

/** Direct-to-Cloudinary signed upload params for mobile/web clients. */
export const createSignedUploadParams = (userId: string, kind = 'common') => {
  const timestamp = Math.floor(Date.now() / 1000);
  if (!isCloudinaryConfigured) {
    return {
      enabled: false,
      timestamp,
      signature: '',
      apiKey: '',
      cloudName: '',
      folder: folderFor(kind),
    };
  }

  init();
  const folder = folderFor(kind);
  const paramsToSign = `folder=${folder}&timestamp=${timestamp}`;
  const signature = crypto
    .createHash('sha1')
    .update(paramsToSign + ENV.CLOUDINARY_API_SECRET)
    .digest('hex');

  return {
    enabled: true,
    timestamp,
    signature,
    apiKey: ENV.CLOUDINARY_API_KEY,
    cloudName: ENV.CLOUDINARY_CLOUD_NAME,
    folder,
    userId,
  };
};

export const isStorageConfigured = isCloudinaryConfigured;
