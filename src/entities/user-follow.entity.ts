import {
  Entity,
  PrimaryColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';

/**
 * A "follow" edge: `followerId` follows `followingId`. PK (followerId, followingId)
 * enforces one edge per pair. Powers profile follower/following counts and the
 * Follow button.
 */
@Entity('user_follows')
@Index(['followingId'])
export class UserFollow {
  @PrimaryColumn('uuid')
  followerId: string;

  @PrimaryColumn('uuid')
  followingId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'followerId' })
  follower: User;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'followingId' })
  following: User;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
