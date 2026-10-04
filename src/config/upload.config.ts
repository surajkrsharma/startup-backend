import { ENV } from './env.config';

export const UPLOAD = {
  IMAGE: {
    MAX_SIZE_MB: 5,
    MAX_COUNT: 10,
    ALLOWED_MIME: ['image/jpeg', 'image/png', 'image/webp'],
  },
  VIDEO: {
    MAX_SIZE_MB: 50,
    MAX_COUNT: 2,
    ALLOWED_MIME: ['video/mp4', 'video/webm'],
  },
  DOCUMENT: {
    MAX_SIZE_MB: 10,
    MAX_COUNT: 5,
    ALLOWED_MIME: ['application/pdf'],
  },
  CSV: {
    MAX_SIZE_MB: 20,
    MAX_COUNT: 1,
    ALLOWED_MIME: [
      'text/csv',
      'application/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
  },
  KYC: {
    MAX_SIZE_MB: 10,
    MAX_COUNT: 5,
    ALLOWED_MIME: ['application/pdf', 'image/jpeg', 'image/png'],
  },
  CHAT: {
    MAX_SIZE_MB: 10,
    MAX_COUNT: 5,
    ALLOWED_MIME: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  },

  CLOUDINARY_FOLDER: ENV.CLOUDINARY_FOLDER || 'projectname',
  TEMP_DIR: 'uploads/tmp',
  SIGNED_URL_EXPIRY_SEC: 3600,
};

export const UPLOAD_KIND = {
  IMAGE: 'IMAGE',
  VIDEO: 'VIDEO',
  DOCUMENT: 'DOCUMENT',
  CSV: 'CSV',
  KYC: 'KYC',
  CHAT: 'CHAT',
} as const;

export type UploadKind = keyof typeof UPLOAD_KIND;

export const getUploadLimits = (kind: UploadKind) => {
  switch (kind) {
    case UPLOAD_KIND.VIDEO:
      return UPLOAD.VIDEO;
    case UPLOAD_KIND.DOCUMENT:
      return UPLOAD.DOCUMENT;
    case UPLOAD_KIND.CSV:
      return UPLOAD.CSV;
    case UPLOAD_KIND.KYC:
      return UPLOAD.KYC;
    case UPLOAD_KIND.CHAT:
      return UPLOAD.CHAT;
    case UPLOAD_KIND.IMAGE:
    default:
      return UPLOAD.IMAGE;
  }
};
