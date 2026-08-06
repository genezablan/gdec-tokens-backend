import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Community } from './community.entity';
import { User } from './user.entity';

/**
 * A pending invitation for someone to join a community — the mirror image of
 * `community_requests`, which the invitee raises themselves.
 *
 * Like that table, presence of the row *is* the pending state: accepting or
 * declining deletes it, so there is no status column to drift out of sync with
 * `community_members`.
 *
 * An invitation never grants membership on its own. The invitee has to accept,
 * so nobody is placed in a community they did not choose.
 */
@Entity('community_invitations')
@Index(['userId'])
export class CommunityInvitation {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  communityId: string;

  /** The person being invited. */
  @PrimaryColumn('uuid')
  userId: string;

  /** The community admin who sent it — shown to the invitee for context. */
  @Column('uuid')
  invitedById: string;

  @ManyToOne(() => Community, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'communityId' })
  community: Community;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'invitedById' })
  invitedBy: User;

  @CreateDateColumn({ type: 'timestamptz' })
  invitedAt: Date;
}
