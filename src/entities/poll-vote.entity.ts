import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { Post } from './post.entity';
import { PollOption } from './poll-option.entity';
import { User } from './user.entity';

/**
 * A single poll vote. docs/community.md §12 (`poll_votes`).
 * PK (postId, userId) enforces one vote per user per poll.
 */
@Entity('poll_votes')
export class PollVote {
  @PrimaryColumn('uuid')
  postId: string;

  @PrimaryColumn('uuid')
  userId: string;

  @Column('uuid')
  optionId: string;

  @ManyToOne(() => Post, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'postId' })
  post: Post;

  @ManyToOne(() => PollOption, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'optionId' })
  option: PollOption;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;
}
