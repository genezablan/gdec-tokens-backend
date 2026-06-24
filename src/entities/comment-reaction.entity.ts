import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Comment } from './comment.entity';
import { User } from './user.entity';

/**
 * A reaction on a comment. PK (commentId, userId) enforces one reaction per user
 * per comment. `value` is a free-form reaction: an emoji grapheme (e.g. "🎉") or
 * a curated GIF reference of the form "gif:<id>". Mirrors `reactions` for posts.
 */
@Entity('comment_reactions')
@Index(['userId'])
export class CommentReaction {
  @PrimaryColumn('uuid')
  commentId: string;

  @PrimaryColumn('uuid')
  userId: string;

  @Column({ type: 'varchar' })
  value: string;

  @ManyToOne(() => Comment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'commentId' })
  comment: Comment;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
