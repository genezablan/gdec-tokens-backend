import { ConfigService } from '@nestjs/config';
import { EmailService, SendEmailResponse } from './email.service';

/**
 * Guards the recipient handling behind the all-employee blasts.
 *
 * The bug these were written for: HR posted an announcement and most of the
 * company never got the email. Employee addresses come straight out of a
 * spreadsheet import with no cleaning, and SES rejects an entire SendEmail
 * call — all 45 BCC'd recipients — if one destination is malformed.
 */
describe('EmailService bulk recipients', () => {
  const config = {
    get: (key: string) =>
      ({
        'ses.accessKeyId': 'test-key',
        'ses.secretAccessKey': 'test-secret',
        'ses.region': 'ap-southeast-1',
        'ses.fromEmail': 'tokens@greatdealscorp.com',
        FRONTEND_URL: 'https://devtokens.greatdealscorp.com',
      })[key],
  } as unknown as ConfigService;

  const service = new EmailService(config);
  const normalize = (list: string[]) =>
    (service as any).normalizeRecipients(list) as {
      valid: string[];
      invalid: string[];
    };

  describe('normalizeRecipients', () => {
    it('trims the whitespace the spreadsheet import left behind', () => {
      // Real rows from employee_list.xlsx — SES rejects addresses with
      // surrounding whitespace ("Local address contains control or whitespace").
      const { valid, invalid } = normalize([
        ' lj092593@gmail.com',
        'ladyleefernando51@gmail.com ',
        'rusellealaras032@gmail.com\t',
      ]);
      expect(valid).toEqual([
        'lj092593@gmail.com',
        'ladyleefernando51@gmail.com',
        'rusellealaras032@gmail.com',
      ]);
      expect(invalid).toEqual([]);
    });

    it('splits a cell that holds two addresses joined by newlines', () => {
      // "araramos@gmail.com\r\n\r\na.ramos@greatdealscorp.com" is a single
      // users.email value in production. Both addresses belong to the employee.
      const { valid } = normalize([
        'araramos@gmail.com\r\n\r\na.ramos@greatdealscorp.com',
      ]);
      expect(valid).toEqual(['araramos@gmail.com', 'a.ramos@greatdealscorp.com']);
    });

    it('drops junk instead of handing it to SES', () => {
      const { valid, invalid } = normalize(['n/a', 'none', 'ok@example.com']);
      expect(valid).toEqual(['ok@example.com']);
      expect(invalid).toEqual(['n/a', 'none']);
    });

    it('dedupes case-insensitively', () => {
      const { valid } = normalize(['HR@greatdealscorp.com', 'hr@greatdealscorp.com']);
      expect(valid).toEqual(['HR@greatdealscorp.com']);
    });

    it('ignores empty values', () => {
      const { valid, invalid } = normalize(['', '   ', 'ok@example.com']);
      expect(valid).toEqual(['ok@example.com']);
      expect(invalid).toEqual([]);
    });
  });

  describe('sendBulkBcc', () => {
    const ok: SendEmailResponse = { messageId: 'id', success: true, message: 'sent' };
    const rejected: SendEmailResponse = {
      messageId: '',
      success: false,
      message: 'Failed to send email: Illegal address',
    };

    const sendBulk = (recipients: string[]) =>
      (service as any).sendBulkBcc({
        recipients,
        subject: 'subject',
        htmlBody: '<p>body</p>',
        textBody: 'body',
        label: 'test',
      }) as Promise<{ sent: number; failed: string[] }>;

    afterEach(() => jest.restoreAllMocks());

    it('BCCs in batches of 45 to stay under the SES 50-recipient cap', async () => {
      const send = jest.spyOn(service, 'sendEmail').mockResolvedValue(ok);
      const recipients = Array.from({ length: 100 }, (_, i) => `u${i}@example.com`);

      const result = await sendBulk(recipients);

      expect(send).toHaveBeenCalledTimes(3);
      expect((send.mock.calls[0][0].bcc as string[]).length).toBe(45);
      expect((send.mock.calls[2][0].bcc as string[]).length).toBe(10);
      expect(result).toEqual({ sent: 100, failed: [] });
    });

    it('retries a rejected batch one address at a time', async () => {
      // The whole point: a batch SES refuses must not cost the other 44 people
      // their copy — the previous code swallowed the rejection and moved on.
      const send = jest
        .spyOn(service, 'sendEmail')
        .mockResolvedValueOnce(rejected)
        .mockResolvedValue(ok);

      const result = await sendBulk(['a@example.com', 'b@example.com', 'c@example.com']);

      expect(send).toHaveBeenCalledTimes(4); // 1 batch + 3 individual
      expect(result).toEqual({ sent: 3, failed: [] });
    });

    it('reports the addresses that still fail individually', async () => {
      const send = jest.spyOn(service, 'sendEmail').mockImplementation((req) => {
        const to = Array.isArray(req.to) ? req.to[0] : req.to;
        return Promise.resolve(to === 'bad@example.com' ? rejected : ok);
      });
      send.mockResolvedValueOnce(rejected); // the batch itself

      const result = await sendBulk(['good@example.com', 'bad@example.com']);

      expect(result.sent).toBe(1);
      expect(result.failed).toEqual(['bad@example.com']);
    });

    it('sends nothing when no address survives normalization', async () => {
      const send = jest.spyOn(service, 'sendEmail').mockResolvedValue(ok);
      const result = await sendBulk(['n/a', '']);
      expect(send).not.toHaveBeenCalled();
      expect(result).toEqual({ sent: 0, failed: [] });
    });
  });
});
