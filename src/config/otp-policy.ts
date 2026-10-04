import { ENV, isEmailConfigured, isOtpDeliverable, isSmsConfigured } from './env.config';

export const isOtpRequired = (): boolean => ENV.OTP_REQUIRED;

export const isOtpEnforceable = (): boolean => ENV.OTP_REQUIRED && isOtpDeliverable;

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

export const availableChannels = (isEmail: boolean): string[] => {
  if (isEmail && isEmailConfigured) return ['EMAIL'];
  if (!isEmail && isSmsConfigured) return ['SMS'];
  if (isEmailConfigured || isSmsConfigured) return ['EMAIL', 'SMS'];
  return [];
};
