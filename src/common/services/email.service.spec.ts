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
        'ses.maxSendRate': 100000, // effectively no pacing delay in tests
        'ses.maxSendAttempts': 3,
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

    it('does not fan a throttled batch out into individual sends', async () => {
      // What actually broke on 2026-09-02: SES answered "Maximum sending rate
      // exceeded". Retrying that batch as 45 separate messages would hand SES
      // 45x the load it just refused, so the batch is recorded and abandoned.
      const throttled: SendEmailResponse = {
        messageId: '',
        success: false,
        message: 'Failed to send email: Maximum sending rate exceeded.',
        throttled: true,
      };
      const send = jest.spyOn(service, 'sendEmail').mockResolvedValue(throttled);

      const result = await sendBulk(['a@example.com', 'b@example.com']);

      expect(send).toHaveBeenCalledTimes(1); // the batch only — no per-address retry
      expect(result.sent).toBe(0);
      expect(result.failed).toEqual(['a@example.com', 'b@example.com']);
    });
  });

  describe('announcement formatting', () => {
    const bodyHtml =
      '<p>First line.<br>Second line.</p><p>A <strong>bold</strong> paragraph.</p><ul><li>One</li><li>Two</li></ul>';

    const capture = async (opts: Partial<Parameters<EmailService['sendAnnouncementEmail']>[0]> = {}) => {
      let sent: { htmlBody?: string; textBody?: string } = {};
      jest.spyOn(service, 'sendEmail').mockImplementation(async (req) => {
        sent = req;
        return { messageId: 'x', success: true, message: '' };
      });
      await service.sendAnnouncementEmail({
        recipients: ['a@example.com'],
        title: 'Title',
        excerpt: 'First line. Second line. A bold paragraph. One Two',
        authorName: 'HR',
        ...opts,
      });
      return sent;
    };

    afterEach(() => jest.restoreAllMocks());

    it('keeps the author paragraphs instead of one run-on line', async () => {
      // The reported bug: the CEO's masterclass post arrived as a single
      // unbroken sentence because postCard collapsed all whitespace.
      const { htmlBody } = await capture({ bodyHtml });
      expect(htmlBody!.match(/<p style="margin:0 0 12px/g)).toHaveLength(2);
      expect(htmlBody).toContain('<strong>bold</strong>');
      expect(htmlBody).toContain('<li style="margin:0 0 6px');
    });

    it('sends the whole announcement, not a 320-character excerpt', async () => {
      const long = `<p>${'word '.repeat(200).trim()}</p>`;
      const { htmlBody } = await capture({ bodyHtml: long });
      expect(htmlBody).not.toContain('…');
      expect(htmlBody!.length).toBeGreaterThan(1000);
    });

    it('gives the text part real line breaks', async () => {
      const { textBody } = await capture({ bodyHtml });
      expect(textBody).toContain('First line.\nSecond line.');
      expect(textBody).toContain('• One');
      expect(textBody).not.toMatch(/First line\. Second line\./);
    });

    it('falls back to the plain excerpt when there is no rich body', async () => {
      const { htmlBody } = await capture({ bodyHtml: null });
      expect(htmlBody).toContain('First line. Second line.');
    });
  });

  describe('throttling', () => {
    const throttleError = Object.assign(new Error('Maximum sending rate exceeded.'), {
      name: 'Throttling',
    });

    const sesSend = () => (service as any).sesClient.send as jest.Mock;

    beforeEach(() => {
      (service as any).sesClient.send = jest.fn();
      (service as any).sendQueue = Promise.resolve();
      (service as any).nextSendAt = 0;
    });

    const send = () =>
      service.sendEmail({ to: 'a@example.com', subject: 's', textBody: 'b' });

    it('recognises the SES rate-limit rejection', () => {
      const isThrottle = (e: unknown) => (service as any).isThrottleError(e);
      expect(isThrottle(throttleError)).toBe(true);
      expect(isThrottle(new Error('Maximum sending rate exceeded.'))).toBe(true);
      expect(isThrottle(new Error('Illegal address'))).toBe(false);
      expect(isThrottle(null)).toBe(false);
    });

    it('retries a throttled send and succeeds', async () => {
      sesSend()
        .mockRejectedValueOnce(throttleError)
        .mockResolvedValueOnce({ MessageId: 'mid' });

      const result = await send();

      expect(sesSend()).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(true);
    });

    it('gives up after the configured attempts and flags it as throttled', async () => {
      sesSend().mockRejectedValue(throttleError);

      const result = await send();

      expect(sesSend()).toHaveBeenCalledTimes(3); // ses.maxSendAttempts
      expect(result.success).toBe(false);
      expect(result.throttled).toBe(true);
    });

    it('does not retry an error that waiting cannot fix', async () => {
      sesSend().mockRejectedValue(new Error('Illegal address'));

      const result = await send();

      expect(sesSend()).toHaveBeenCalledTimes(1);
      expect(result.throttled).toBe(false);
    });

    it('keeps sending after a failure — the queue must not stall', async () => {
      sesSend()
        .mockRejectedValueOnce(new Error('Illegal address'))
        .mockResolvedValueOnce({ MessageId: 'mid' });

      const first = await send();
      const second = await send();

      expect(first.success).toBe(false);
      expect(second.success).toBe(true);
    });

    it('spends the rate budget per recipient, not per message', async () => {
      // The heart of the 2026-09-02 failure: SES charges its rate limit per
      // recipient, so a 45-address BCC batch must reserve 45 slots. At 45/s
      // that batch owes the next send a full second.
      const paced = new EmailService({
        get: (key: string) =>
          ({
            'ses.accessKeyId': 'k',
            'ses.secretAccessKey': 's',
            'ses.maxSendRate': 45,
            'ses.maxSendAttempts': 1,
          })[key],
      } as unknown as ConfigService);
      (paced as any).sesClient.send = jest.fn().mockResolvedValue({ MessageId: 'mid' });

      const started = Date.now();
      await paced.sendEmail({
        to: 'from@example.com',
        bcc: Array.from({ length: 45 }, (_, i) => `u${i}@example.com`),
        subject: 's',
        textBody: 'b',
      });
      await paced.sendEmail({ to: 'next@example.com', subject: 's', textBody: 'b' });
      const elapsed = Date.now() - started;

      // 46 recipients at 45/s ≈ 1.02s of budget before the second send may go.
      expect(elapsed).toBeGreaterThanOrEqual(950);
    });
  });
});
