import { describe, it, expect, beforeEach, vi } from 'vitest';
import { store, makeUser, TEST_CODE, type Row } from './helpers/auth-fake';

vi.mock('../src/services/prisma.service', async () => {
  const { store: fake } = await import('./helpers/auth-fake');
  return {
    prisma: fake.prisma,
    PrismaService: class {},
    disconnectPrisma: vi.fn(async () => undefined),
    connectPrisma: vi.fn(async () => undefined),
  };
});

vi.mock('bcrypt', () => {
  const enc = (v: string) => `${v}$bcrypt$`;
  const compare = (v: string, h: string) => v === String(h).replace('$bcrypt$', '');
  return {
    default: {
      hash: async (v: string) => enc(v),
      hashSync: (v: string) => enc(v),
      compare: async (v: string, h: string) => compare(v, h),
      compareSync: (v: string, h: string) => compare(v, h),
    },
    compare: async (v: string, h: string) => compare(v, h),
    hash: async (v: string) => enc(v),
  };
});

vi.mock('../src/config/otp-policy', () => ({
  isOtpEnforceable: () => true,
  isOtpRequired: () => true,
  isOtpDeliverable: true,
  otpRequirement: () => ({ required: true, deliverable: true, reason: 'test' }),
  availableChannels: () => ['EMAIL', 'SMS'],
}));

vi.mock('../src/services/settings.service', () => ({
  getSecurityConfig: async () => ({
    maxAttempts: 5,
    lockoutMinutes: 15,
    sessionDays: 7,
    otpLoginEnabled: true,
    twoFactorEnabled: false,
    requirePhoneVerify: false,
    requireEmailVerify: false,
  }),
  getVendorAutoApprove: async () => false,
  getCommissionDefault: async () => 10,
}));

vi.mock('../src/services/email.service', () => ({ sendOtpEmail: vi.fn(async () => undefined) }));
vi.mock('../src/services/sms/sms.service', () => ({ sendOtpSms: vi.fn(async () => undefined) }));
vi.mock('../src/services/audit.service', () => ({
  writeAuditLog: vi.fn(async () => undefined),
  writeActivityLog: vi.fn(async () => undefined),
}));
vi.mock('../src/jobs/queues', () => ({ enqueueEmail: vi.fn(async () => undefined) }));

import { OTP } from '../src/config/otp.config';
import { ERROR_CODE } from '../src/constants/http';
import { sha256 } from '../src/utils/crypto';
import * as authService from '../src/modules/auth/auth.service';
import { consumeVerification } from '../src/modules/auth/auth.verification';

const CODE = TEST_CODE;
const EMAIL = 'ravi@example.com';
const OTHER_EMAIL = 'someone.else@example.com';
const PHONE = '+919876543210';

const device = {
  deviceId: 'dev-1',
  platform: 'WEB',
  ip: '127.0.0.1',
  userAgent: 'vitest',
  sessionKey: 'sess-1',
} as any;

const seedOtp = (over: Row = {}) => {
  const identifier = over.identifier ?? EMAIL;
  const row: Row = {
    identifier,
    type: 'LOGIN',
    channel: String(identifier).includes('@') ? 'EMAIL' : 'SMS',
    otpHash: `${CODE}$bcrypt$`,
    expiresAt: new Date(Date.now() + 10 * 60_000),
    attempts: 0,
    isVerified: false,
    verifiedAt: null,
    lastSentAt: new Date(),
    sendDay: new Date().toISOString().slice(0, 10),
    sendCount: 1,
    createdAt: new Date(),
    ...over,
  };
  store.db.otps.push(row);
  return row;
};

const seedVerification = (over: Row = {}) => {
  const row: Row = {
    tokenHash: 'seed-hash',
    purpose: 'LOGIN',
    identifier: EMAIL,
    channel: 'EMAIL',
    userId: 'user-1',
    expiresAt: new Date(Date.now() + 15 * 60_000),
    usedAt: null,
    ...over,
  };
  store.db.verifications.push(row);
  return row;
};

const codeOf = async (fn: () => Promise<unknown>): Promise<string | null> => {
  try {
    await fn();
    return null;
  } catch (err) {
    return (err as Row)?.code ?? null;
  }
};

beforeEach(() => {
  store.reset();
});

describe('registration flow', () => {
  it('creates no account when no verification token is presented', async () => {
    seedOtp({ type: 'REGISTER' });

    const code = await codeOf(() =>
      authService.registerCustomer(
        { type: 'CUSTOMER', name: 'Ravi', email: EMAIL, password: 'Aa1!aaaa' },
        device,
      ),
    );

    expect(code).toBe(ERROR_CODE.VERIFICATION_INVALID);
    expect(store.db.users).toHaveLength(0);
  });

  it('will not accept a bare OTP sent alongside the details', async () => {
    seedOtp({ type: 'REGISTER' });

    const code = await codeOf(() =>
      authService.registerCustomer(
        { type: 'CUSTOMER', name: 'Ravi', email: EMAIL, password: 'Aa1!aaaa', otp: CODE },
        device,
      ),
    );

    expect(code).toBe(ERROR_CODE.VERIFICATION_INVALID);
    expect(store.db.users).toHaveLength(0);
  });

  it('verifies a code and mints a token without creating an account', async () => {
    seedOtp({ type: 'REGISTER' });

    const result = await authService.verifyRegistrationOtp({ identifier: EMAIL, otp: CODE });

    expect(result.verificationToken).toMatch(/^[0-9a-f]{64}$/);
    expect(result.identifier).toBe(EMAIL);
    expect(store.db.users).toHaveLength(0);
  });

  it('completes registration once the token is spent, marking the proven contact verified', async () => {
    seedOtp({ type: 'REGISTER' });
    const { verificationToken } = await authService.verifyRegistrationOtp({
      identifier: EMAIL,
      otp: CODE,
    });

    const { user, tokens } = await authService.registerCustomer(
      { type: 'CUSTOMER', name: 'Ravi', email: EMAIL, password: 'Aa1!aaaa', verificationToken },
      device,
    );

    expect(user.isEmailVerified).toBe(true);
    expect(tokens.accessToken).toBeTruthy();
    expect(tokens.refreshToken).toBeTruthy();
  });

  it('marks a phone proof as phone-only, leaving the email unverified', async () => {
    seedOtp({ identifier: PHONE, type: 'REGISTER' });
    const { verificationToken } = await authService.verifyRegistrationOtp({
      identifier: PHONE,
      otp: CODE,
    });

    const { user } = await authService.registerCustomer(
      {
        type: 'CUSTOMER',
        name: 'Ravi',
        email: EMAIL,
        phone: PHONE,
        password: 'Aa1!aaaa',
        verificationToken,
      },
      device,
    );

    expect(user.isPhoneVerified).toBe(true);
    expect(user.isEmailVerified).toBe(false);
  });

  it('completes vendor registration with its shop record', async () => {
    seedOtp({ type: 'REGISTER' });
    const { verificationToken } = await authService.verifyRegistrationOtp({
      identifier: EMAIL,
      otp: CODE,
    });

    const { user } = await authService.registerVendor(
      {
        type: 'VENDOR',
        name: 'Ravi',
        email: EMAIL,
        password: 'Aa1!aaaa',
        shopName: 'Ravi Store',
        verificationToken,
      },
      device,
    );

    expect(user.role).toBe('VENDOR');
    expect(store.db.users).toHaveLength(1);
    expect(store.db.vendors).toHaveLength(1);
  });

  it('treats email case differences as the same contact', async () => {
    seedOtp({ identifier: EMAIL, type: 'REGISTER' });
    const { verificationToken } = await authService.verifyRegistrationOtp({
      identifier: 'Ravi@Example.COM',
      otp: CODE,
    });

    const { user } = await authService.registerCustomer(
      {
        type: 'CUSTOMER',
        name: 'Ravi',
        email: 'RAVI@example.com',
        password: 'Aa1!aaaa',
        verificationToken,
      },
      device,
    );

    expect(user.email).toBe(EMAIL);
  });
});

describe('registration identifier binding', () => {
  it('refuses a token proved for one email to register a different email', async () => {
    seedOtp({ type: 'REGISTER' });
    const { verificationToken } = await authService.verifyRegistrationOtp({
      identifier: EMAIL,
      otp: CODE,
    });

    const code = await codeOf(() =>
      authService.registerCustomer(
        {
          type: 'CUSTOMER',
          name: 'Mallory',
          email: OTHER_EMAIL,
          password: 'Aa1!aaaa',
          verificationToken,
        },
        device,
      ),
    );

    expect(code).toBe(ERROR_CODE.VERIFICATION_IDENTIFIER_MISMATCH);
    expect(store.db.users).toHaveLength(0);
  });

  it('refuses a phone token to be spent on an unrelated phone', async () => {
    seedOtp({ identifier: PHONE, type: 'REGISTER' });
    const { verificationToken } = await authService.verifyRegistrationOtp({
      identifier: PHONE,
      otp: CODE,
    });

    const code = await codeOf(() =>
      authService.registerCustomer(
        {
          type: 'CUSTOMER',
          name: 'Mallory',
          email: EMAIL,
          phone: '+919000000000',
          password: 'Aa1!aaaa',
          verificationToken,
        },
        device,
      ),
    );

    expect(code).toBe(ERROR_CODE.VERIFICATION_IDENTIFIER_MISMATCH);
    expect(store.db.users).toHaveLength(0);
  });

  it('does not burn the token when the identifier does not match', async () => {
    seedOtp({ type: 'REGISTER' });
    const { verificationToken } = await authService.verifyRegistrationOtp({
      identifier: EMAIL,
      otp: CODE,
    });

    const rejected = await codeOf(() =>
      authService.registerCustomer(
        {
          type: 'CUSTOMER',
          name: 'Mallory',
          email: OTHER_EMAIL,
          password: 'Aa1!aaaa',
          verificationToken,
        },
        device,
      ),
    );

    expect(rejected).toBe(ERROR_CODE.VERIFICATION_IDENTIFIER_MISMATCH);

    const { user } = await authService.registerCustomer(
      {
        type: 'CUSTOMER',
        name: 'Ravi',
        email: EMAIL,
        password: 'Aa1!aaaa',
        verificationToken,
      },
      device,
    );

    expect(user.isEmailVerified).toBe(true);
  });

  it('refuses a phone proof when the submitted contact is a different email', async () => {
    seedOtp({ identifier: PHONE, type: 'REGISTER' });
    const { verificationToken } = await authService.verifyRegistrationOtp({
      identifier: PHONE,
      otp: CODE,
    });

    const code = await codeOf(() =>
      authService.registerCustomer(
        {
          type: 'CUSTOMER',
          name: 'Mallory',
          email: EMAIL,
          password: 'Aa1!aaaa',
          verificationToken,
        },
        device,
      ),
    );

    expect(code).toBe(ERROR_CODE.VERIFICATION_IDENTIFIER_MISMATCH);
  });
});

describe('OTP validity', () => {
  it('rejects a wrong code and counts the attempt', async () => {
    const row = seedOtp();

    const code = await codeOf(() => authService.consumeOtp(EMAIL, 'LOGIN', '000000'));

    expect(code).toBe(ERROR_CODE.OTP_INVALID);
    expect(store.db.otps.find((r) => r.id === row.id)?.attempts).toBe(1);
  });

  it('locks a code out after the maximum number of wrong attempts', async () => {
    seedOtp();

    const codes: (string | null)[] = [];
    for (let i = 0; i < OTP.MAX_ATTEMPTS; i += 1) {
      codes.push(await codeOf(() => authService.consumeOtp(EMAIL, 'LOGIN', '000000')));
    }

    expect(codes.slice(0, -1)).toEqual(Array(OTP.MAX_ATTEMPTS - 1).fill(ERROR_CODE.OTP_INVALID));
    expect(codes[codes.length - 1]).toBe(ERROR_CODE.OTP_MAX_ATTEMPTS);
  });

  it('rejects a code whose expiry has passed', async () => {
    seedOtp({ expiresAt: new Date(Date.now() - 1000) });

    expect(await codeOf(() => authService.consumeOtp(EMAIL, 'LOGIN', CODE))).toBe(
      ERROR_CODE.OTP_INVALID,
    );
  });

  it('accepts a code that is still live, then refuses the same code again', async () => {
    seedOtp();

    expect(await codeOf(() => authService.consumeOtp(EMAIL, 'LOGIN', CODE))).toBeNull();
    expect(await codeOf(() => authService.consumeOtp(EMAIL, 'LOGIN', CODE))).toBe(
      ERROR_CODE.OTP_INVALID,
    );
  });

  it('rejects an expired code at the registration verify step and mints nothing', async () => {
    seedOtp({ type: 'REGISTER', expiresAt: new Date(Date.now() - 1000) });

    const code = await codeOf(() =>
      authService.verifyRegistrationOtp({ identifier: EMAIL, otp: CODE }),
    );

    expect(code).toBe(ERROR_CODE.OTP_INVALID);
    expect(store.db.verifications).toHaveLength(0);
  });

  it('rejects a wrong code at the registration verify step and mints nothing', async () => {
    seedOtp({ type: 'REGISTER' });

    const code = await codeOf(() =>
      authService.verifyRegistrationOtp({ identifier: EMAIL, otp: '000000' }),
    );

    expect(code).toBe(ERROR_CODE.OTP_INVALID);
    expect(store.db.verifications).toHaveLength(0);
  });

  it('will not verify a code against an identifier it was not sent to', async () => {
    seedOtp({ identifier: EMAIL });

    expect(await codeOf(() => authService.consumeOtp(OTHER_EMAIL, 'LOGIN', CODE))).toBe(
      ERROR_CODE.OTP_INVALID,
    );
  });

  it('accepts a phone code sent over SMS', async () => {
    seedOtp({ identifier: PHONE });

    expect(await codeOf(() => authService.consumeOtp(PHONE, 'LOGIN', CODE))).toBeNull();
  });
});

describe('verification token', () => {
  it('cannot create a second account', async () => {
    seedOtp({ type: 'REGISTER' });
    const { verificationToken } = await authService.verifyRegistrationOtp({
      identifier: EMAIL,
      otp: CODE,
    });

    await authService.registerCustomer(
      { type: 'CUSTOMER', name: 'Ravi', email: EMAIL, password: 'Aa1!aaaa', verificationToken },
      device,
    );

    const replay = await codeOf(() =>
      authService.registerCustomer(
        {
          type: 'CUSTOMER',
          name: 'Ravi Again',
          email: OTHER_EMAIL,
          password: 'Aa1!aaaa',
          verificationToken,
        },
        device,
      ),
    );

    expect(replay).toBe(ERROR_CODE.VERIFICATION_INVALID);
    expect(store.db.users).toHaveLength(1);
  });

  it('cannot be spent once expired', async () => {
    seedVerification({ expiresAt: new Date(Date.now() - 1000) });

    expect(await codeOf(() => consumeVerification('any-token', 'LOGIN'))).toBe(
      ERROR_CODE.VERIFICATION_INVALID,
    );
  });

  it('cannot be spent for a purpose it was not minted for', async () => {
    seedVerification({ purpose: 'REGISTER', tokenHash: sha256('reg-only') });

    expect(await codeOf(() => consumeVerification('reg-only', 'LOGIN'))).toBe(
      ERROR_CODE.VERIFICATION_INVALID,
    );
  });

  it('rejects a token it has never issued', async () => {
    expect(await codeOf(() => consumeVerification('f'.repeat(64), 'LOGIN'))).toBe(
      ERROR_CODE.VERIFICATION_INVALID,
    );
  });

  it('stores only a hash, never the token itself', async () => {
    seedOtp({ type: 'REGISTER' });
    const { verificationToken } = await authService.verifyRegistrationOtp({
      identifier: EMAIL,
      otp: CODE,
    });

    const stored = store.db.verifications.find((r) => r.purpose === 'REGISTER');

    expect(stored).toBeDefined();
    expect(stored!.tokenHash).not.toBe(verificationToken);
    expect(stored!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is spent atomically, so only one of two concurrent claims wins', async () => {
    seedVerification({ tokenHash: sha256('race-token') });

    const [a, b] = await Promise.all([
      codeOf(() => consumeVerification('race-token', 'LOGIN')),
      codeOf(() => consumeVerification('race-token', 'LOGIN')),
    ]);

    expect([a, b].filter((c) => c === null)).toHaveLength(1);
    expect([a, b].filter((c) => c === ERROR_CODE.VERIFICATION_INVALID)).toHaveLength(1);
  });
});

describe('login with OTP', () => {
  it('issues the session only after the code is verified', async () => {
    store.db.users.push(makeUser());
    seedOtp();

    const outcome = await authService.verifyLoginOtp({ identifier: EMAIL, otp: CODE }, device);

    expect(outcome.user.id).toBe('user-1');
    expect(outcome.tokens.accessToken).toBeTruthy();
    expect(store.db.refreshTokens).toHaveLength(1);
  });

  it('mints no verification token, because there is no third step', async () => {
    store.db.users.push(makeUser());
    seedOtp();

    await authService.verifyLoginOtp({ identifier: EMAIL, otp: CODE }, device);

    expect(store.db.verifications).toHaveLength(0);
  });

  it('signs in the identifier the code was sent to, not one named in the body', async () => {
    store.db.users.push(makeUser(), makeUser({ id: 'user-2', email: OTHER_EMAIL }));
    seedOtp();

    const outcome = await authService.verifyLoginOtp(
      { identifier: EMAIL, otp: CODE, channel: undefined },
      device,
    );

    expect(outcome.user.id).toBe('user-1');
  });

  it('issues no session for an expired code', async () => {
    store.db.users.push(makeUser());
    seedOtp({ expiresAt: new Date(Date.now() - 1000) });

    const code = await codeOf(() =>
      authService.verifyLoginOtp({ identifier: EMAIL, otp: CODE }, device),
    );

    expect(code).toBe(ERROR_CODE.OTP_INVALID);
    expect(store.db.refreshTokens).toHaveLength(0);
  });

  it('issues no session for a wrong code', async () => {
    store.db.users.push(makeUser());
    seedOtp();

    const code = await codeOf(() =>
      authService.verifyLoginOtp({ identifier: EMAIL, otp: '000000' }, device),
    );

    expect(code).toBe(ERROR_CODE.OTP_INVALID);
    expect(store.db.refreshTokens).toHaveLength(0);
  });

  it('refuses a code that was already spent', async () => {
    store.db.users.push(makeUser());
    seedOtp();

    expect(
      await codeOf(() => authService.verifyLoginOtp({ identifier: EMAIL, otp: CODE }, device)),
    ).toBeNull();

    expect(
      await codeOf(() => authService.verifyLoginOtp({ identifier: EMAIL, otp: CODE }, device)),
    ).toBe(ERROR_CODE.OTP_INVALID);
    expect(store.db.refreshTokens).toHaveLength(1);
  });

  it('refuses a code minted for a password reset', async () => {
    store.db.users.push(makeUser());
    seedOtp({ type: 'FORGOT_PASSWORD' });

    expect(
      await codeOf(() => authService.verifyLoginOtp({ identifier: EMAIL, otp: CODE }, device)),
    ).toBe(ERROR_CODE.OTP_INVALID);
    expect(store.db.refreshTokens).toHaveLength(0);
  });

  it('refuses a code minted for a contact change', async () => {
    store.db.users.push(makeUser());
    seedOtp({ type: 'CHANGE_PASSWORD' });

    expect(
      await codeOf(() => authService.verifyLoginOtp({ identifier: EMAIL, otp: CODE }, device)),
    ).toBe(ERROR_CODE.OTP_INVALID);
  });

  it('refuses a code minted for registration', async () => {
    store.db.users.push(makeUser());
    seedOtp({ type: 'REGISTER' });

    expect(
      await codeOf(() => authService.verifyLoginOtp({ identifier: EMAIL, otp: CODE }, device)),
    ).toBe(ERROR_CODE.OTP_INVALID);
  });

  it('refuses a code issued for a different identifier', async () => {
    store.db.users.push(makeUser());
    seedOtp({ identifier: OTHER_EMAIL });

    expect(
      await codeOf(() => authService.verifyLoginOtp({ identifier: EMAIL, otp: CODE }, device)),
    ).toBe(ERROR_CODE.OTP_INVALID);
  });

  it('issues no session for an identifier with no account', async () => {
    const code = await codeOf(() =>
      authService.verifyLoginOtp({ identifier: EMAIL, otp: CODE }, device),
    );

    expect(code).toBe(ERROR_CODE.OTP_INVALID);
    expect(store.db.refreshTokens).toHaveLength(0);
  });

  it('issues no session for a suspended account', async () => {
    store.db.users.push(makeUser({ isActive: false }));
    seedOtp();

    expect(
      await codeOf(() => authService.verifyLoginOtp({ identifier: EMAIL, otp: CODE }, device)),
    ).toBe(ERROR_CODE.ACCOUNT_SUSPENDED);
    expect(store.db.refreshTokens).toHaveLength(0);
  });

  it('issues no session for an account with no verified contact', async () => {
    store.db.users.push(makeUser({ isEmailVerified: false, isPhoneVerified: false }));
    seedOtp();

    expect(
      await codeOf(() => authService.verifyLoginOtp({ identifier: EMAIL, otp: CODE }, device)),
    ).toBe(ERROR_CODE.ACCOUNT_UNVERIFIED);
    expect(store.db.refreshTokens).toHaveLength(0);
  });
});

describe('OTP send throttling', () => {
  beforeEach(() => {
    store.db.users.push(makeUser());
  });

  const cooldownPast = () => new Date(Date.now() - (OTP.RESEND_COOLDOWN_SEC + 5) * 1000);

  it('allows the first send for an identifier', async () => {
    const result = await authService.sendOtp({
      type: 'LOGIN',
      channel: 'EMAIL',
      identifier: EMAIL,
    });

    expect(result.channel).toBe('EMAIL');
    expect(store.db.otps).toHaveLength(1);
  });

  it('rejects an immediate resend for the same identifier and purpose', async () => {
    await authService.sendOtp({ type: 'LOGIN', channel: 'EMAIL', identifier: EMAIL });

    expect(
      await codeOf(() =>
        authService.sendOtp({ type: 'LOGIN', channel: 'EMAIL', identifier: EMAIL }),
      ),
    ).toBe(ERROR_CODE.OTP_RESEND_COOLDOWN);
  });

  it('allows a resend once the cooldown has elapsed', async () => {
    await authService.sendOtp({ type: 'LOGIN', channel: 'EMAIL', identifier: EMAIL });
    store.db.otps[0].lastSentAt = cooldownPast();

    const result = await authService.sendOtp({
      type: 'LOGIN',
      channel: 'EMAIL',
      identifier: EMAIL,
    });

    expect(result.identifier).toBe(EMAIL);
  });

  it('throttles each purpose independently', async () => {
    await authService.sendOtp({ type: 'LOGIN', channel: 'EMAIL', identifier: EMAIL });

    const result = await authService.sendOtp({
      type: 'FORGOT_PASSWORD',
      channel: 'EMAIL',
      identifier: EMAIL,
    });

    expect(result.identifier).toBe(EMAIL);
  });

  it('enforces the daily cap even once the cooldown has elapsed', async () => {
    for (let i = 0; i < OTP.MAX_RESENDS_PER_DAY; i += 1) {
      await authService.sendOtp({ type: 'LOGIN', channel: 'EMAIL', identifier: EMAIL });
      store.db.otps[0].lastSentAt = cooldownPast();
    }

    expect(
      await codeOf(() =>
        authService.sendOtp({ type: 'LOGIN', channel: 'EMAIL', identifier: EMAIL }),
      ),
    ).toBe(ERROR_CODE.OTP_RESEND_COOLDOWN);
  });

  it('resets the daily count when the day rolls over', async () => {
    for (let i = 0; i < OTP.MAX_RESENDS_PER_DAY; i += 1) {
      await authService.sendOtp({ type: 'LOGIN', channel: 'EMAIL', identifier: EMAIL });
      store.db.otps[0].lastSentAt = cooldownPast();
    }

    store.db.otps[0].sendDay = '2000-01-01';

    await authService.sendOtp({ type: 'LOGIN', channel: 'EMAIL', identifier: EMAIL });

    expect(store.db.otps[0].sendCount).toBe(1);
  });

  it('refuses to send a login code to an identifier with no account', async () => {
    store.db.users.length = 0;

    expect(
      await codeOf(() =>
        authService.sendOtp({ type: 'LOGIN', channel: 'EMAIL', identifier: EMAIL }),
      ),
    ).toBe(ERROR_CODE.INVALID_CREDENTIALS);
    expect(store.db.otps).toHaveLength(0);
  });

  it('reports a new user for an identifier nobody has claimed', async () => {
    const result = await authService.sendOtp({
      type: 'REGISTER',
      channel: 'EMAIL',
      identifier: OTHER_EMAIL,
    });

    expect(result.isNewUser).toBe(true);
  });

  it('routes a phone code to SMS whatever channel was requested', async () => {
    store.db.users.push(makeUser({ id: 'u2', phone: PHONE, email: OTHER_EMAIL }));

    const result = await authService.sendOtp({ type: 'LOGIN', channel: 'BOTH', identifier: PHONE });

    expect(result.channel).toBe('SMS');
  });

  it('rejects an identifier that is neither an email nor a phone number', async () => {
    expect(
      await codeOf(() =>
        authService.sendOtp({ type: 'REGISTER', channel: 'EMAIL', identifier: 'not a contact' }),
      ),
    ).toBe(ERROR_CODE.VALIDATION_ERROR);
  });
});

describe('OTP purpose separation', () => {
  beforeEach(() => {
    store.db.users.push(makeUser());
  });

  it('will not accept a LOGIN code as authority to change a password', async () => {
    seedOtp({ type: 'LOGIN' });

    expect(
      await codeOf(() =>
        authService.changePassword('user-1', 'Secret@123', 'NewSecret@123', false, CODE),
      ),
    ).toBe(ERROR_CODE.OTP_INVALID);
  });

  it('accepts a CHANGE_PASSWORD code for a password change', async () => {
    seedOtp({ type: 'CHANGE_PASSWORD' });

    await authService.changePassword('user-1', 'Secret@123', 'NewSecret@123', false, CODE);

    expect(store.db.users[0].passwordHash).toBe('NewSecret@123$bcrypt$');
  });

  it('will not accept a password-reset code to verify an email change', async () => {
    seedOtp({ type: 'FORGOT_PASSWORD' });

    expect(
      await codeOf(() => authService.verifyContact('user-1', { email: EMAIL, otp: CODE })),
    ).toBe(ERROR_CODE.OTP_INVALID);
  });

  it('verifies a contact with the matching EMAIL_VERIFY code', async () => {
    store.db.users[0].isEmailVerified = false;
    seedOtp({ type: 'EMAIL_VERIFY' });

    const result = await authService.verifyContact('user-1', { email: EMAIL, otp: CODE });

    expect(result.emailVerified).toBe(true);
  });

  it('refuses to verify a contact the account does not own', async () => {
    seedOtp({ identifier: OTHER_EMAIL, type: 'EMAIL_VERIFY' });

    expect(
      await codeOf(() => authService.verifyContact('user-1', { email: OTHER_EMAIL, otp: CODE })),
    ).toBe(ERROR_CODE.VALIDATION_ERROR);
  });
});

describe('two-factor challenge', () => {
  it('is refused by the middleware that guards protected routes', async () => {
    const { signTwoFactorChallengeToken, isSessionToken, signAccessToken } =
      await import('../src/utils/crypto');

    const challenge = signTwoFactorChallengeToken({
      sub: 'user-1',
      role: 'CUSTOMER',
      vendorId: '',
      email: EMAIL,
      sessionKey: 'sess-1',
      deviceId: 'dev-1',
    });

    expect(isSessionToken({ purpose: 'two_factor' })).toBe(false);
    expect(challenge.split('.')).toHaveLength(3);
    expect(isSessionToken({ purpose: 'session' })).toBe(true);
    expect(
      isSessionToken(JSON.parse(Buffer.from(challenge.split('.')[1], 'base64').toString())),
    ).toBe(false);

    const session = signAccessToken({
      sub: 'user-1',
      role: 'CUSTOMER',
      vendorId: '',
      email: EMAIL,
      sessionKey: 'sess-1',
      deviceId: 'dev-1',
    });
    const claims = JSON.parse(Buffer.from(session.split('.')[1], 'base64').toString());
    expect(claims.purpose).toBe('session');
  });
});
