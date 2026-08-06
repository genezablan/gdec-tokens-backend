import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';

/**
 * Stores a user's (coach's) OAuth connection to an external calendar provider.
 * Currently only Microsoft 365 / Outlook is supported.
 *
 * Tokens are stored ENCRYPTED at rest (AES-256-GCM via CalendarCryptoService).
 * One connection per user — enforced by a unique index on userId.
 */
@Entity('calendar_connections')
export class CalendarConnection {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ─── Owner ──────────────────────────────────────────────────────────────────

  @Index({ unique: true })
  @Column()
  userId: string;

  @ManyToOne(() => User, { eager: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  // ─── Provider ────────────────────────────────────────────────────────────────

  @Column({ length: 20, default: 'microsoft' })
  provider: string;

  /** Email of the connected Microsoft account (for display only). */
  @Column({ type: 'varchar', length: 255, nullable: true })
  accountEmail: string | null;

  // ─── Tokens (encrypted) ────────────────────────────────────────────────────────

  /** Encrypted OAuth access token. */
  @Column({ type: 'text', nullable: true })
  accessTokenEnc: string | null;

  /** Encrypted OAuth refresh token (granted via offline_access scope). */
  @Column({ type: 'text', nullable: true })
  refreshTokenEnc: string | null;

  /** When the current access token expires. */
  @Column({ type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  /** Space-separated scopes granted on the last token exchange. */
  @Column({ type: 'text', nullable: true })
  scopes: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  connectedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
