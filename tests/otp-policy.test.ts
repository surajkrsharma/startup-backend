import { describe, it, expect } from 'vitest';
import { isOtpEnforceable, otpRequirement } from '../src/config/otp-policy';
import { ENV } from '../src/config/env.config';

describe('OTP policy', () => {
  it('treats the static code as a delivery channel', () => {
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
