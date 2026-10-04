import crypto from 'crypto';
import type { RequestHandler } from 'express';
import { ENCRYPTION, isEncryptionReady, isSkippedPath } from '../config/encryption.config';
import { ERROR_CODE, HTTP_STATUS } from '../constants/http';
import { ERROR } from '../messages/error';
import { VALIDATION } from '../messages/validation';
import { AppError } from '../utils/AppError';

export interface EncryptedPayload {
  iv: string;
  tag: string;
  data: string;
}

const getKey = (): Buffer => Buffer.from(ENCRYPTION.KEY, 'hex');

export const decryptPayload = (payload: EncryptedPayload): any => {
  if (!payload || !payload.iv || !payload.tag || !payload.data) {
    throw new AppError(
      ERROR.COMMON.ENCRYPTION_FAILED,
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODE.INVALID_ENCRYPTED_PAYLOAD,
    );
  }

  try {
    const iv = Buffer.from(payload.iv, 'base64');
    const tag = Buffer.from(payload.tag, 'base64');
    const decipher = crypto.createDecipheriv(ENCRYPTION.ALGORITHM, getKey(), iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(payload.data, 'base64')),
      decipher.final(),
    ]);
    return JSON.parse(decrypted.toString('utf8'));
  } catch {
    throw new AppError(
      ERROR.COMMON.ENCRYPTION_FAILED,
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODE.DECRYPT_FAILED,
    );
  }
};

export const encryptPayload = (data: any): EncryptedPayload => {
  const iv = crypto.randomBytes(ENCRYPTION.IV_LENGTH);
  const cipher = crypto.createCipheriv(ENCRYPTION.ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: encrypted.toString('base64'),
  };
};

const wantsEncryption = (req: any): boolean =>
  req.headers[ENCRYPTION.HEADER_NAME] === ENCRYPTION.HEADER_VALUE;

export const encryptionMiddleware: RequestHandler = (req, res, next) => {
  if (!isEncryptionReady()) return next();
  if (isSkippedPath(req.path)) return next();

  if (req.headers['content-type']?.includes('multipart/form-data')) return next();

  const isEncrypted = wantsEncryption(req);

  if (isEncrypted) {
    const body = (req.body ?? {}) as Partial<EncryptedPayload>;
    if (!body.data || !body.iv || !body.tag) {
      return next(
        new AppError(
          VALIDATION.INVALID_JSON,
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODE.INVALID_ENCRYPTED_PAYLOAD,
        ),
      );
    }
    try {
      req.body = decryptPayload(body as EncryptedPayload);
    } catch (err) {
      return next(err);
    }
    res.locals.shouldEncrypt = true;
  }

  const originalJson = res.json.bind(res);
  res.json = (payload: any) => {
    if (res.locals.shouldEncrypt && payload) {
      try {
        return originalJson({ encrypted: true, ...encryptPayload(payload) });
      } catch {
        return originalJson(payload);
      }
    }
    return originalJson(payload);
  };

  next();
};
