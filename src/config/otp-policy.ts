import { ENV, isEmailConfigured, isOtpDeliverable, isSmsConfigured } from './env.config';

/**
 * Single place that answers "does this flow need an OTP right now?".
 *
 * Every enforcement point reads `OTP_REQUIRED` through here rather than reading
 * the flag directly, so turning it off cannot leave one code path still
 * demanding a code. The flag exists because a fresh checkout has no email or SMS
 * provider, and without it nobody could register at all.
 */
export const isOtpRequired = (): boolean => ENV.OTP_REQUIRED;

/** OTP is only required if a code can actually be delivered. */
export const isOtpEnforceable = (): boolean => ENV.OTP_REQUIRED && isOtpDeliverable;

/**
 * Why a code is required, for logs and error messages. A missing provider is
 * reported separately from the flag so the fix is obvious.
 */
export const otpRequirement = (): { required: boolean; deliverable: boolean; reason: string } => {
  if (!ENV.OTP_REQUIRED) {
    return {
      required: false,
      deliverable: isOtpDeliverable,
      reason: 'OTP_REQUIRED=false — codes are not requested or checked',
    };
  }
  if (!isOtpDeliverable) {
    return {
      required: true,
      deliverable: false,
      reason: 'OTP_REQUIRED=true but no email or SMS provider is configured',
    };
  }
  return { required: true, deliverable: true, reason: 'OTP_REQUIRED=true' };
};

/** Which channels can actually carry a code for this identifier. */
export const availableChannels = (isEmail: boolean): string[] => {
  if (isEmail && isEmailConfigured) return ['EMAIL'];
  if (!isEmail && isSmsConfigured) return ['SMS'];
  if (isEmailConfigured || isSmsConfigured) return ['EMAIL', 'SMS'];
  return [];
};
