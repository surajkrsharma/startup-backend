import { describe, it, expect } from 'vitest';
import {
  registerSchema,
  verifyOtpSchema,
  loginSchema,
  loginVerifyOtpSchema,
  registrationSendOtpSchema,
  registrationVerifyOtpSchema,
  changePasswordSchema,
} from '../src/modules/auth/auth.schema';

const TOKEN = 'a'.repeat(64);

describe('register schema', () => {
  const base = {
    type: 'CUSTOMER',
    name: 'Real User',
    email: 'user@example.com',
    password: 'Aa1!aaaa',
    verificationToken: TOKEN,
  };

  it('accepts a body carrying a verification token', () => {
    expect(registerSchema.safeParse(base).success).toBe(true);
  });

  it('refuses a registration with no verification token', () => {
    const { verificationToken, ...withoutToken } = base;
    expect(registerSchema.safeParse(withoutToken).success).toBe(false);
  });

  it('refuses a token that is too short to have been issued', () => {
    expect(registerSchema.safeParse({ ...base, verificationToken: 'abc' }).success).toBe(false);
  });

  it('no longer accepts an inline otp', () => {
    expect(registerSchema.safeParse({ ...base, otp: '111111' }).success).toBe(false);
  });

  it('accepts a vendor registration carrying a verification token', () => {
    const r = registerSchema.safeParse({
      type: 'VENDOR',
      name: 'Real User',
      email: 'user@example.com',
      password: 'Aa1!aaaa',
      verificationToken: TOKEN,
      shopName: 'My Shop',
    });
    expect(r.success).toBe(true);
  });

  it('reports a bad token as a token problem, not as a bad register type', () => {
    const r = registerSchema.safeParse({ ...base, verificationToken: 'x' });
    expect(r.success).toBe(false);
    if (!r.success) {
      const messages = r.error.errors.map((e) => e.message).join(' | ');
      expect(messages).not.toContain('Invalid register type');
    }
  });

  it('still reports an unrecognised register type clearly', () => {
    const r = registerSchema.safeParse({ ...base, type: 'HACKER' });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.errors.map((e) => e.message)).toContain('Invalid register type.');
    }
  });

  it('refuses a smuggled verification flag', () => {
    expect(registerSchema.safeParse({ ...base, isEmailVerified: true }).success).toBe(false);
  });

  it('refuses a smuggled role', () => {
    expect(registerSchema.safeParse({ ...base, role: 'SUPER_ADMIN' }).success).toBe(false);
  });
});

describe('registration step schemas', () => {
  it('asks for an identifier and nothing else', () => {
    expect(registrationSendOtpSchema.safeParse({ identifier: 'user@example.com' }).success).toBe(
      true,
    );
  });

  it('refuses a step-1 request that tries to set the otp purpose', () => {
    expect(
      registrationSendOtpSchema.safeParse({ identifier: 'u@example.com', type: 'LOGIN' }).success,
    ).toBe(false);
  });

  it('needs an identifier and a code to verify', () => {
    expect(
      registrationVerifyOtpSchema.safeParse({ identifier: 'user@example.com', otp: '111111' })
        .success,
    ).toBe(true);
    expect(registrationVerifyOtpSchema.safeParse({ identifier: 'u@example.com' }).success).toBe(
      false,
    );
  });

  it('rejects a code of the wrong length', () => {
    expect(
      registrationVerifyOtpSchema.safeParse({ identifier: 'u@example.com', otp: '123' }).success,
    ).toBe(false);
  });
});

describe('login step schemas', () => {
  it('accepts password login', () => {
    expect(loginSchema.safeParse({ email: 'u@example.com', password: 'Aa1!aaaa' }).success).toBe(
      true,
    );
  });

  it('requires a password', () => {
    expect(loginSchema.safeParse({ email: 'u@example.com' }).success).toBe(false);
  });

  it('no longer accepts an otp on this endpoint', () => {
    expect(
      loginSchema.safeParse({ email: 'u@example.com', password: 'Aa1!aaaa', otp: '111111' })
        .success,
    ).toBe(false);
  });

  it('no longer accepts a client-chosen otp purpose', () => {
    expect(
      loginSchema.safeParse({
        email: 'u@example.com',
        password: 'Aa1!aaaa',
        type: 'FORGOT_PASSWORD',
      }).success,
    ).toBe(false);
  });

  it('verifies a login code without asking for a token', () => {
    expect(
      loginVerifyOtpSchema.safeParse({ identifier: 'u@example.com', otp: '111111' }).success,
    ).toBe(true);
  });

  it('refuses a verification token on the login verify step', () => {
    expect(
      loginVerifyOtpSchema.safeParse({ identifier: 'u@example.com', verificationToken: TOKEN })
        .success,
    ).toBe(false);
  });
});

describe('changePassword schema', () => {
  const base = { currentPassword: 'Aa1!aaaa', newPassword: 'Bb2!bbbb' };

  it('accepts a change without an otp', () => {
    expect(changePasswordSchema.safeParse(base).success).toBe(true);
  });

  it('accepts a change carrying an otp', () => {
    expect(changePasswordSchema.safeParse({ ...base, otp: '111111' }).success).toBe(true);
  });

  it('rejects a malformed otp', () => {
    expect(changePasswordSchema.safeParse({ ...base, otp: '12' }).success).toBe(false);
  });
});

describe('verifyOtp schema', () => {
  it('rejects an otp of the wrong length', () => {
    const r = verifyOtpSchema.safeParse({
      type: 'FORGOT_PASSWORD',
      identifier: 'user@example.com',
      otp: '123',
    });
    expect(r.success).toBe(false);
  });

  it('accepts a well-formed verification request', () => {
    const r = verifyOtpSchema.safeParse({
      type: 'FORGOT_PASSWORD',
      identifier: 'user@example.com',
      otp: '111111',
    });
    expect(r.success).toBe(true);
  });

  it('refuses the login purpose, which mints a token instead', () => {
    const r = verifyOtpSchema.safeParse({
      type: 'LOGIN',
      identifier: 'user@example.com',
      otp: '111111',
    });
    expect(r.success).toBe(false);
  });

  it('refuses the register purpose, which mints a token instead', () => {
    expect(
      verifyOtpSchema.safeParse({
        type: 'REGISTER',
        identifier: 'user@example.com',
        otp: '111111',
      }).success,
    ).toBe(false);
  });

  it('no longer accepts the single-step login flag', () => {
    expect(
      verifyOtpSchema.safeParse({
        type: 'FORGOT_PASSWORD',
        identifier: 'user@example.com',
        otp: '111111',
        isLoginFlow: true,
      }).success,
    ).toBe(false);
  });
});
