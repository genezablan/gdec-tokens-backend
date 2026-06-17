import {
  Entity,
  PrimaryColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Post } from './post.entity';
import { User } from './user.entity';

/**
 * Records that a user viewed a post — powers `seenBy` (count) and `seenByMe`.
 * PK (postId, userId) makes the "seen" mutation idempotent per user.
 * docs/community.md §12 (`post_views`).
 */
@Entity('post_views')
export class PostView {
  @PrimaryColumn('uuid')
  postId: string;

  @PrimaryColumn('uuid')
  userId: string;

  @ManyToOne(() => Post, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'postId' })
  post: Post;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @CreateDateColumn({ type: 'timestamptz' })
  viewedAt: Date;
}
