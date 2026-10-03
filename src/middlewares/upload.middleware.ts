import fs from 'fs';
import path from 'path';
import multer from 'multer';
import type { RequestHandler } from 'express';
import { UPLOAD, getUploadLimits, UploadKind } from '../config/upload.config';
import { ERROR } from '../messages/error';
import { AppError } from '../utils/AppError';
import { ERROR_CODE, HTTP_STATUS } from '../constants/http';
import { toSlug } from '../utils/slug';
import { randomString } from '../utils/crypto';

const TEMP_DIR = UPLOAD.TEMP_DIR;

const ensureTempDir = (): string => {
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }
  return TEMP_DIR;
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    try {
      cb(null, ensureTempDir());
    } catch (err) {
      cb(err as Error, TEMP_DIR);
    }
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(0, 10);
    const base = toSlug(path.basename(file.originalname, ext)) || 'file';
    cb(null, `${Date.now()}-${base}-${randomString(6)}${ext}`);
  },
});

const fileFilter = (allowedMime: string[]) => (_req: any, file: any, cb: any) => {
  if (!allowedMime.includes(file.mimetype)) {
    return cb(
      new AppError(
        ERROR.UPLOAD.UNSUPPORTED_TYPE,
        HTTP_STATUS.UNSUPPORTED_MEDIA_TYPE,
        ERROR_CODE.UNSUPPORTED_TYPE,
      ),
    );
  }
  return cb(null, true);
};

/**
 * Multipart handler with MIME + size + count validation.
 * Binary payloads are never run through the encryption middleware.
 */
export const uploadFiles = (kind: UploadKind, field = 'files'): RequestHandler => {
  const limits = getUploadLimits(kind);
  return multer({
    storage,
    limits: {
      fileSize: limits.MAX_SIZE_MB * 1024 * 1024,
      files: limits.MAX_COUNT,
      fields: 30,
    },
    fileFilter: fileFilter(limits.ALLOWED_MIME),
  }).array(field, limits.MAX_COUNT);
};

/** Single-file variant — rejects immediately when no file is present. */
export const uploadSingle = (kind: UploadKind, field = 'file'): RequestHandler => {
  const limits = getUploadLimits(kind);
  return multer({
    storage,
    limits: {
      fileSize: limits.MAX_SIZE_MB * 1024 * 1024,
      files: 1,
      fields: 30,
    },
    fileFilter: fileFilter(limits.ALLOWED_MIME),
  }).single(field);
};

/** In-memory variant for small payloads (CSV/Excel parsing). */
export const uploadMemory = (kind: UploadKind, field = 'file'): RequestHandler => {
  const limits = getUploadLimits(kind);
  return multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: limits.MAX_SIZE_MB * 1024 * 1024,
      files: 1,
      fields: 30,
    },
    fileFilter: fileFilter(limits.ALLOWED_MIME),
  }).single(field);
};

export const deleteTempFile = async (filePath: string): Promise<void> => {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) await fs.promises.unlink(filePath);
  } catch {
    /* ignore */
  }
};

export const deleteTempFiles = async (files: Express.Multer.File[] = []): Promise<void> => {
  await Promise.all(files.map((f) => deleteTempFile(f.path)));
};

export const getUploadedFiles = (req: any): Express.Multer.File[] => {
  const single = req?.file;
  if (single) return [single];
  return Array.isArray(req?.files) ? req.files : [];
};

export const ensureFilePresent = (req: any): Express.Multer.File => {
  const files = getUploadedFiles(req);
  if (!files.length || !files[0]) {
    throw new AppError(
      ERROR.UPLOAD.FILE_REQUIRED,
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODE.FILE_REQUIRED,
    );
  }
  return files[0];
};
