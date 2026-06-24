import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Post } from './post.entity';
import { User } from './user.entity';

/**
 * A reaction. docs/community.md §12 (`reactions`).
 * PK (postId, userId) enforces one reaction per user per post.
 * `type` is a free-form reaction value: an emoji grapheme (e.g. "🎉") or a
 * curated GIF reference of the form "gif:<id>".
 */
@Entity('reactions')
export class Reaction {
  @PrimaryColumn('uuid')
  postId: string;

  @PrimaryColumn('uuid')
  userId: string;

  @Column({ type: 'varchar' })
  type: string;

  @ManyToOne(() => Post, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'postId' })
  post: Post;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
