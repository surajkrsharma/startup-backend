import { ENV } from './env.config';

export const OTP = {
  LENGTH: 6,
  EXPIRY_MIN: 10,
  MAX_ATTEMPTS: 3,
  RESEND_COOLDOWN_SEC: 60,
  MAX_RESENDS_PER_DAY: 10,
  BCRYPT_ROUNDS: 10,
  ATTEMPT_LOCK_MIN: 15,

  staticCode: ENV.OTP_STATIC_CODE,
};

export const OTP_LENGTH_RANGE = { MIN: 4, MAX: 8 } as const;
