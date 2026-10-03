import { ENV, isBrevoConfigured, isSmtpConfigured, isTest } from '../../config/env.config';
import { logger } from '../logger.service';
import { renderTemplate } from '../template.service';
import { D } from '../../utils/defaults';
import nodemailer, { Transporter } from 'nodemailer';

export interface MailPayload {
  to: string;
  subject?: string;
  html?: string;
  text?: string;
  templateKey?: string;
  templateData?: Record<string, any>;
  from?: string;
  replyTo?: string;
}

export interface SendResult {
  sent: boolean;
  messageId: string;
  reason: string;
  provider: string;
}

let transporter: Transporter | null = null;

const getTransporter = (): Transporter | null => {
  if (!isSmtpConfigured) return null;
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: ENV.SMTP_HOST,
    port: ENV.SMTP_PORT,
    secure: ENV.SMTP_SECURE,
    auth: ENV.SMTP_USER ? { user: ENV.SMTP_USER, pass: ENV.SMTP_PASS } : undefined,
  });

  return transporter;
};

/**
 * Brevo's transactional API. Used in preference to SMTP because it needs no
 * credentials in a password manager and no open relay — just one API key.
 * Docs: https://developers.brevo.com/reference/sendtransacemail
 */
const sendViaBrevo = async (p: {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}): Promise<SendResult> => {
  const fromEmail = ENV.BREVO_FROM_EMAIL || ENV.MAIL_FROM_EMAIL;
  const fromName = ENV.BREVO_FROM_NAME || ENV.BREVO_SENDER_NAME || ENV.MAIL_FROM_NAME;

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': ENV.BREVO_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { email: fromEmail, name: fromName },
        to: [{ email: p.to }],
        subject: p.subject,
        htmlContent: p.html || undefined,
        textContent: p.text || undefined,
        replyTo: p.replyTo ? { email: p.replyTo } : undefined,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      logger.error(
        { status: response.status, to: p.to, detail: detail.slice(0, 300) },
        '[email] brevo rejected the message',
      );
      return { sent: false, messageId: '', reason: `BREVO_${response.status}`, provider: 'brevo' };
    }

    const body = (await response.json().catch(() => ({}))) as { messageId?: string };
    logger.info(
      { to: p.to, subject: p.subject, messageId: body.messageId },
      '[email] sent via brevo',
    );
    return { sent: true, messageId: body.messageId ?? '', reason: '', provider: 'brevo' };
  } catch (err) {
    logger.error({ err: (err as Error)?.message, to: p.to }, '[email] brevo request failed');
    return { sent: false, messageId: '', reason: 'BREVO_REQUEST_FAILED', provider: 'brevo' };
  }
};

const sendViaSmtp = async (p: {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  from?: string;
}): Promise<SendResult> => {
  const mailer = getTransporter();
  if (!mailer) {
    return { sent: false, messageId: '', reason: 'SMTP_NOT_CONFIGURED', provider: 'smtp' };
  }

  try {
    const info = await mailer.sendMail({
      from: p.from
        ? `"${ENV.MAIL_FROM_NAME}" <${p.from}>`
        : `"${ENV.MAIL_FROM_NAME}" <${ENV.MAIL_FROM_EMAIL}>`,
      to: p.to,
      subject: p.subject,
      html: p.html,
      text: p.text,
      replyTo: p.replyTo,
    });

    logger.info(
      { to: p.to, subject: p.subject, messageId: info.messageId },
      '[email] sent via smtp',
    );
    return { sent: true, messageId: info.messageId ?? '', reason: '', provider: 'smtp' };
  } catch (err) {
    logger.error({ err: (err as Error)?.message, to: p.to }, '[email] smtp send failed');
    return { sent: false, messageId: '', reason: 'SEND_FAILED', provider: 'smtp' };
  }
};

/**
 * Sends transactional mail through whichever provider is configured, preferring
 * Brevo over SMTP. With neither configured the message is logged rather than
 * thrown, so a flow never breaks just because email was never set up.
 */
export const sendMail = async (payload: MailPayload): Promise<SendResult> => {
  let subject = D.str(payload.subject);
  let html = D.str(payload.html);
  let text = D.str(payload.text);

  if (payload.templateKey) {
    const rendered = await renderTemplate(payload.templateKey, payload.templateData ?? {});
    subject = payload.subject || rendered.subject;
    html = payload.html || rendered.html;
    text = payload.text || rendered.text;
  }

  if (!payload.to) {
    return { sent: false, messageId: '', reason: 'MISSING_RECIPIENT', provider: 'none' };
  }

  if (isTest) {
    return { sent: false, messageId: '', reason: 'TEST_ENV', provider: 'none' };
  }

  if (isBrevoConfigured) {
    return sendViaBrevo({ to: payload.to, subject, html, text, replyTo: payload.replyTo });
  }

  if (isSmtpConfigured) {
    return sendViaSmtp({
      to: payload.to,
      subject,
      html,
      text,
      replyTo: payload.replyTo,
      from: payload.from,
    });
  }

  logger.info({ to: payload.to, subject }, '[email] no provider configured — skipped send');
  return { sent: false, messageId: '', reason: 'NO_PROVIDER', provider: 'none' };
};

export const sendOtpEmail = (to: string, otp: string, purpose: string): Promise<SendResult> =>
  sendMail({
    to,
    templateKey: 'reset_password',
    templateData: { otp, purpose, appName: ENV.APP_NAME },
  });

export const sendOrderConfirmation = (
  to: string,
  order: Record<string, any>,
): Promise<SendResult> =>
  sendMail({
    to,
    templateKey: 'order_confirm',
    templateData: { order, appName: ENV.APP_NAME },
  });
