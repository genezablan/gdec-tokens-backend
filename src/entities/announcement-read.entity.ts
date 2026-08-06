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
 * Records that a user has opened an announcement.
 *
 * The (announcementId, userId) pair is the primary key — a user reads a given
 * announcement at most once, so there's no surrogate id and inserting twice is a
 * no-op rather than a duplicate.
 */
@Entity('announcement_reads')
@Index(['userId'])
export class AnnouncementRead {
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
  readAt: Date;
}
