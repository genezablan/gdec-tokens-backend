import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { PostType, PraiseBadge } from '../common/enums';
import { Community } from './community.entity';
import { User } from './user.entity';
import { PostAttachment } from './post-attachment.entity';
import { PollOption } from './poll-option.entity';
import { Comment } from './comment.entity';

/**
 * A feed post. docs/community.md §3.5, §12 (`posts`).
 *
 * Per-user computed fields (`myReaction`, `seenBy`, `reactionCounts`, `poll`)
 * and the denormalized `community` brief are assembled by the mapper, not stored.
 */
@Entity('posts')
@Index(['communityId', 'createdAt'])
@Index(['createdAt'])
export class Post {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  communityId: string;

  @ManyToOne(() => Community, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'communityId' })
  community: Community;

  @Column('uuid')
  authorId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'authorId' })
  author: User;

  @Column({ type: 'enum', enum: PostType })
  type: PostType;

  @Column({ type: 'varchar', length: 200, nullable: true })
  title: string | null;

  /** Plain-text fallback for previews & search. */
  @Column({ type: 'text', nullable: true })
  body: string | null;

  /** Sanitized rich HTML (sanitized on write — never trust the client). */
  @Column({ type: 'text', nullable: true })
  bodyHtml: string | null;

  /** Present only for `praise` posts. */
  @Column({ type: 'enum', enum: PraiseBadge, nullable: true })
  badge: PraiseBadge | null;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  topics: string[];

  @Column({ default: false })
  pinned: boolean;

  @OneToMany(() => PostAttachment, (a) => a.post)
  attachments: PostAttachment[];

  @OneToMany(() => PollOption, (o) => o.post)
  pollOptions: PollOption[];

  @OneToMany(() => Comment, (c) => c.post)
  comments: Comment[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
