import { registerAs } from '@nestjs/config';

export default registerAs('ses', () => ({
  accessKeyId: process.env.SES_ACCESS_KEY_ID,
  secretAccessKey: process.env.SES_SECRET_ACCESS_KEY,
  region: process.env.SES_REGION || 'ap-southeast-1',
  fromEmail: process.env.SES_FROM_EMAIL || 'tokens@greatdealscorp.com',
  fromDomain: process.env.EMAIL_FROM_DOMAIN || 'greatdealscorp.com',
  /**
   * RECIPIENTS per second we allow ourselves to hand SES — not messages. SES
   * charges its rate limit per recipient, so one 45-address BCC batch spends 45
   * of these, and this account's MaxSendRate is 14/s. That is why ten batches
   * fired back to back on 2026-09-02 (~405 recipients in five seconds) had four
   * rejected with "Maximum sending rate exceeded".
   *
   * Default 12 leaves headroom under the measured 14 for the approval and
   * coaching emails that go out alongside a blast.
   */
  maxSendRate: Number(process.env.SES_MAX_SEND_RATE) || 12,
  /** Attempts per message when SES answers "Maximum sending rate exceeded". */
  maxSendAttempts: Number(process.env.SES_MAX_SEND_ATTEMPTS) || 5,
}));
