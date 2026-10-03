import { describe, it, expect } from 'vitest';
import {
  registerSchema,
  verifyOtpSchema,
  changePasswordSchema,
} from '../src/modules/auth/auth.schema';

/**
 * Registration is the only unauthenticated way to create an account, so it is
 * the only place where "do you actually own this email/phone" can be proven.
 *
 * `otp` is OPTIONAL in the schema and enforced in the service, gated on
 * OTP_REQUIRED. That split is deliberate: making it conditionally required here
 * would change the request contract the moment the flag is toggled, and the
 * requirement itself would then be duplicated in two places.
 */
describe('register schema', () => {
  const base = {
    type: 'CUSTOMER',
    name: 'Real User',
    email: 'user@example.com',
    password: 'Aa1!aaaa',
  };

  it('accepts a body with no otp field', () => {
    // Whether this is enough is decided by OTP_REQUIRED in the service.
    expect(registerSchema.safeParse(base).success).toBe(true);
  });

  it('accepts a well-formed otp', () => {
    const r = registerSchema.safeParse({ ...base, otp: '111111' });
    expect(r.success).toBe(true);
    if (r.success) expect((r.data as { otp: string }).otp).toBe('111111');
  });

  it('rejects an otp that is not OTP.LENGTH digits', () => {
    expect(registerSchema.safeParse({ ...base, otp: '12345' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, otp: '1234567' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, otp: '' }).success).toBe(false);
  });

  it('accepts a vendor registration carrying an otp', () => {
    const r = registerSchema.safeParse({
      type: 'VENDOR',
      name: 'Real User',
      email: 'user@example.com',
      password: 'Aa1!aaaa',
      otp: '111111',
      shopName: 'My Shop',
    });
    expect(r.success).toBe(true);
  });

  it('reports a bad otp as an OTP problem, not as a bad register type', () => {
    // A catch-all branch here would mask the real field behind "Invalid register type."
    const r = registerSchema.safeParse({ ...base, otp: '123' });
    expect(r.success).toBe(false);
    if (!r.success) {
      const messages = r.error.errors.map((e) => e.message).join(' | ');
      expect(messages).not.toContain('Invalid register type');
    }
  });

  it('still reports an unrecognised register type clearly', () => {
    const r = registerSchema.safeParse({ ...base, type: 'HACKER', otp: '111111' });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.errors.map((e) => e.message)).toContain('Invalid register type.');
    }
  });

  it('refuses a smuggled verification flag', () => {
    expect(
      registerSchema.safeParse({ ...base, otp: '111111', isEmailVerified: true }).success,
    ).toBe(false);
  });

  it('refuses a smuggled role', () => {
    expect(registerSchema.safeParse({ ...base, otp: '111111', role: 'SUPER_ADMIN' }).success).toBe(
      false,
    );
  });
});

describe('changePassword schema', () => {
  const base = { currentPassword: 'Aa1!aaaa', newPassword: 'Bb2!bbbb' };

  it('accepts a change without an otp', () => {
    // Also gated on OTP_REQUIRED, in the service.
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
      type: 'LOGIN',
      identifier: 'user@example.com',
      otp: '123',
    });
    expect(r.success).toBe(false);
  });

  it('accepts a well-formed verification request', () => {
    const r = verifyOtpSchema.safeParse({
      type: 'LOGIN',
      identifier: 'user@example.com',
      otp: '111111',
    });
    expect(r.success).toBe(true);
  });
});
