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
 * One user's reaction to an announcement with a specific emoji.
 *
 * (announcementId, userId, emoji) is the key: a user may react with several
 * different emoji, but the same emoji twice is the same fact. That makes the
 * toggle an insert-or-delete rather than a read-modify-write.
 */
@Entity('announcement_reactions')
@Index(['announcementId', 'emoji'])
export class AnnouncementReaction {
  @PrimaryColumn({ type: 'uuid' })
  announcementId: string;

  @PrimaryColumn({ type: 'uuid' })
  userId: string;

  /** varchar(16) — one emoji can be several code points with modifiers / ZWJ. */
  @PrimaryColumn({ type: 'varchar', length: 16 })
  emoji: string;

  @ManyToOne(() => Announcement, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'announcementId' })
  announcement: Announcement;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
