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

export interface AnnouncementAttachment {
  /** Canonical S3 object URL (re-presigned on read). */
  url: string;
  name: string | null;
}

/**
 * An official announcement — an authoritative, read-only broadcast posted by
 * Admin / HR and visible to everyone. Unlike community posts, announcements have
 * no membership, reactions or comments.
 */
@Entity('announcements')
@Index(['pinned', 'createdAt'])
@Index(['createdAt'])
export class Announcement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Author kept nullable so an announcement survives if its author is removed. */
  @Column({ type: 'uuid', nullable: true })
  authorId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'authorId' })
  author: User | null;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  /** Plain-text fallback for previews & search. */
  @Column({ type: 'text', nullable: true })
  body: string | null;

  /** Sanitized rich HTML (sanitized on write — never trust the client). */
  @Column({ type: 'text', nullable: true })
  bodyHtml: string | null;

  /** Image attachments (photos), stored as canonical S3 URLs. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  attachments: AnnouncementAttachment[];

  @Column({ default: false })
  pinned: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
