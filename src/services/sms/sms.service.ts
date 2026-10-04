import { ENV, isMsg91Configured, isTest } from '../../config/env.config';
import { logger } from '../logger.service';

export interface SmsPayload {
  to: string;

  message: string;
}

export interface SmsResult {
  sent: boolean;
  reason: string;
  provider: string;
}

const toDialable = (raw: string): string => {
  const digits = String(raw).replace(/[^\d]/g, '');
  if (!digits) return '';

  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith(ENV.MSG91_COUNTRY_CODE)) return digits.slice(-10);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  if (raw.trim().startsWith('+')) return `+${digits}`;

  return digits;
};

export const sendSms = async (payload: SmsPayload): Promise<SmsResult> => {
  const to = toDialable(payload.to);

  if (!to) {
    return { sent: false, reason: 'MISSING_RECIPIENT', provider: 'msg91' };
  }

  if (isTest) {
    return { sent: false, reason: 'TEST_ENV', provider: 'msg91' };
  }

  if (!isMsg91Configured) {
    logger.info({ to, message: payload.message }, '[sms] MSG91 not configured — skipped send');
    return { sent: false, reason: 'NO_PROVIDER', provider: 'none' };
  }

  const useTemplate = Boolean(ENV.MSG91_TEMPLATE_ID);

  const endpoint = useTemplate
    ? 'https://control.msg91.com/api/v5/flow/'
    : 'https://control.msg91.com/api/v2/sendsms';

  const body = useTemplate
    ? {
        template_id: ENV.MSG91_TEMPLATE_ID,
        short_url: '0',
        short_url_expire: '0',
        recipients: [
          {
            mobiles: to,

            OTP: payload.message,
            otp: payload.message,
          },
        ],
      }
    : {
        sender: ENV.MSG91_SENDER_ID || 'PROJECTN',
        route: '4',
        country: ENV.MSG91_COUNTRY_CODE,
        sms: [{ message: payload.message, to }],
      };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        authkey: ENV.MSG91_AUTHKEY,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      logger.error(
        { status: response.status, to, detail: detail.slice(0, 300) },
        '[sms] msg91 rejected the message',
      );
      return { sent: false, reason: `MSG91_${response.status}`, provider: 'msg91' };
    }

    logger.info({ to, template: useTemplate }, '[sms] sent via msg91');
    return { sent: true, reason: '', provider: 'msg91' };
  } catch (err) {
    logger.error({ err: (err as Error)?.message, to }, '[sms] msg91 request failed');
    return { sent: false, reason: 'MSG91_REQUEST_FAILED', provider: 'msg91' };
  }
};

export const sendOtpSms = (to: string, otp: string, appName: string): Promise<SmsResult> =>
  sendSms({ to, message: `${otp} is your ${appName} verification code.` });
