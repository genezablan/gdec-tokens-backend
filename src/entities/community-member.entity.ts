import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { CommunityRole } from '../common/enums';
import { Community } from './community.entity';
import { User } from './user.entity';

/**
 * Per-community membership. docs/community.md §12 (`community_members`).
 * Presence of a row = member; `role` distinguishes community admins.
 * Absence of a row = non-member (role `null` in the API).
 */
@Entity('community_members')
@Index(['userId'])
export class CommunityMember {
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

  @Column({ type: 'enum', enum: CommunityRole, default: CommunityRole.MEMBER })
  role: CommunityRole;

  @CreateDateColumn({ type: 'timestamptz' })
  joinedAt: Date;
}
