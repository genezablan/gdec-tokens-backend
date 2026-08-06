import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';

/**
 * AES-256-GCM encryption for calendar OAuth tokens stored at rest.
 *
 * The 32-byte key is derived (SHA-256) from the CALENDAR_TOKEN_ENC_KEY env var,
 * so any sufficiently random secret string works. Output format is:
 *   base64(iv).base64(authTag).base64(ciphertext)
 */
@Injectable()
export class CalendarCryptoService {
  private readonly logger = new Logger(CalendarCryptoService.name);
  private readonly key: Buffer;

  constructor(private readonly configService: ConfigService) {
    const secret =
      this.configService.get<string>('CALENDAR_TOKEN_ENC_KEY') ||
      this.configService.get<string>('JWT_SECRET');

    if (!secret) {
      this.logger.warn(
        'CALENDAR_TOKEN_ENC_KEY is not set; falling back to a static key. Set it in production.',
      );
    }

    // Derive a fixed 32-byte key from whatever secret is provided.
    this.key = createHash('sha256')
      .update(secret || 'gdec-calendar-token-fallback-key')
      .digest();
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString('base64')}.${authTag.toString('base64')}.${enc.toString('base64')}`;
  }

  decrypt(payload: string): string {
    const [ivB64, tagB64, dataB64] = payload.split('.');
    if (!ivB64 || !tagB64 || !dataB64) {
      throw new Error('Malformed encrypted payload');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(ivB64, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
}
