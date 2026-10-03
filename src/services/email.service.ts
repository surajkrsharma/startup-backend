/**
 * Re-exported from `mail/mail.service` so existing import sites keep working.
 * The implementation moved when Brevo support was added.
 */
export {
  sendMail,
  sendOtpEmail,
  sendOrderConfirmation,
  type MailPayload,
  type SendResult,
} from './mail/mail.service';
