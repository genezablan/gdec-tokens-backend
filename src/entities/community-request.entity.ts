import {
  Entity,
  PrimaryColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Community } from './community.entity';
import { User } from './user.entity';

/**
 * A pending join request for a private community.
 * docs/community.md §12 (`community_requests`).
 */
@Entity('community_requests')
@Index(['userId'])
export class CommunityRequest {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  communityId: string;

  @PrimaryColumn('uuid')
  userId: string;

  @ManyToOne(() => Community, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'communityId' })
  community: Community;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @CreateDateColumn({ type: 'timestamptz' })
  requestedAt: Date;
}
