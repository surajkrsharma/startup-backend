import { ENV, isProduction } from './env.config';
import { APP } from './app.config';

const isHexKey = (v: string) => /^[0-9a-fA-F]{64}$/.test(v);

export const ENCRYPTION = {
  ENABLED: ENV.ENCRYPTION_ENABLED,
  ALGORITHM: 'aes-256-gcm',
  KEY: ENV.ENCRYPTION_KEY,
  IV_LENGTH: 12,
  TAG_LENGTH: 16,
  HEADER_NAME: 'x-encrypted',
  HEADER_VALUE: '1',
  SKIP_PATHS: ['/health', '/docs', '/docs.json', '/webhooks', '/track'],
} as const;

/**
 * Matches skip paths against the API-relative route (`/health`), so it works
 * regardless of the mount prefix — the middleware runs before the router.
 */
export const isSkippedPath = (path: string): boolean => {
  const target = path.startsWith(APP.API_PREFIX) ? path.slice(APP.API_PREFIX.length) : path;
  return ENCRYPTION.SKIP_PATHS.some(
    (prefix) => target === prefix || target.startsWith(`${prefix}/`),
  );
};

export const isEncryptionReady = () => ENCRYPTION.ENABLED && isHexKey(ENCRYPTION.KEY);

/** Only ever warn once at boot so logs stay readable. */
export const encryptionBootWarning = () => {
  if (!ENCRYPTION.ENABLED) return null;
  if (isHexKey(ENCRYPTION.KEY)) return null;
  return `[encryption] ENCRYPTION_KEY is not 64 hex characters — encrypted transport disabled. Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`;
};

export const isCookieSecure = () => isProduction;
