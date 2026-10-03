import { describe, it, expect } from 'vitest';
import { isOtpEnforceable, otpRequirement } from '../src/config/otp-policy';
import { ENV } from '../src/config/env.config';

/**
 * `OTP_REQUIRED` is the switch that decides whether a code is demanded at all.
 * The invariant these tests protect: with the flag on a registration cannot
 * succeed without a code, and with it off nothing anywhere still demands one.
 *
 * tests/setup.ts pins OTP_REQUIRED=true, OTP_STATIC_CODE=111111 and no provider,
 * which is the "fresh clone on a laptop" configuration. The request-shape half
 * of this lives in auth-otp.test.ts.
 */
describe('OTP policy', () => {
  it('treats the static code as a delivery channel', () => {
    // Without this, a developer with no provider could never satisfy the flag.
    expect(otpRequirement().deliverable).toBe(true);
  });

  it('reports the flag as on in this configuration', () => {
    expect(ENV.OTP_REQUIRED).toBe(true);
    expect(isOtpEnforceable()).toBe(true);
  });

  it('explains itself when the flag is on', () => {
    const policy = otpRequirement();
    expect(policy.required).toBe(true);
    expect(policy.reason).toContain('OTP_REQUIRED=true');
  });
});
