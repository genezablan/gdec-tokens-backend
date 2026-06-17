import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Post } from './post.entity';

/**
 * A poll option on a `poll` post. docs/community.md §3.4, §12 (`poll_options`).
 * Vote counts (`votes`) and the caller's `myVote` are computed by the mapper.
 */
@Entity('poll_options')
@Index(['postId'])
export class PollOption {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  postId: string;

  @ManyToOne(() => Post, (p) => p.pollOptions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'postId' })
  post: Post;

  @Column({ length: 80 })
  label: string;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;
}
