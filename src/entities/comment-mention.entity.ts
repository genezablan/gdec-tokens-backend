import { Entity, PrimaryColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Comment } from './comment.entity';
import { User } from './user.entity';

/** @mentioned users on a comment. Mirrors `post_mentions` for comments. */
@Entity('comment_mentions')
@Index(['userId'])
export class CommentMention {
  @PrimaryColumn('uuid')
  commentId: string;

  @PrimaryColumn('uuid')
  userId: string;

  @ManyToOne(() => Comment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'commentId' })
  comment: Comment;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;
}
