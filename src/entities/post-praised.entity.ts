import { Entity, PrimaryColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Post } from './post.entity';
import { User } from './user.entity';

/** Praise recipients on a `praise` post. docs/community.md §12 (`post_praised`). */
@Entity('post_praised')
@Index(['userId'])
export class PostPraised {
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
}
