import {
  Entity,
  PrimaryColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Announcement } from './announcement.entity';
import { User } from './user.entity';

/**
 * Records that a user has explicitly acknowledged an announcement that asked for
 * it — the auditable "I have read and understood this" for policy changes.
 *
 * Same composite-key shape as AnnouncementRead: acknowledging twice is a no-op,
 * and `acknowledgedAt` preserves when it happened for reporting.
 *
 * Distinct from a read: opening an announcement marks it read, which is passive.
 * Acknowledging is a deliberate action and never inferred from a read.
 */
@Entity('announcement_acknowledgements')
@Index(['userId'])
export class AnnouncementAcknowledgement {
  @PrimaryColumn({ type: 'uuid' })
  announcementId: string;

  @PrimaryColumn({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => Announcement, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'announcementId' })
  announcement: Announcement;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @CreateDateColumn({ type: 'timestamptz' })
  acknowledgedAt: Date;
}
