import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  OneToMany,
} from 'typeorm';
import { CommunityPrivacy } from '../common/enums';
import { CommunityResource } from './community-resource.entity';

/**
 * A Community ("space"). docs/community.md §3.6, §12.
 *
 * `id` is an opaque string — either a human slug (`general`, `cnb-team`) or a
 * UUID. Caller-relative fields (`isJoined`, `isPending`, `role`) and derived
 * fields (`memberCount`, `pinnedPostIds`) are NOT stored — they are computed
 * per request by the mapper.
 */
@Entity('communities')
export class Community {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  id: string;

  @Column({ length: 150 })
  name: string;

  @Column({ type: 'varchar', length: 100, unique: true, nullable: true })
  slug: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'text', nullable: true })
  about: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  avatarUrl: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  coverUrl: string | null;

  @Column({ type: 'enum', enum: CommunityPrivacy, default: CommunityPrivacy.PUBLIC })
  privacy: CommunityPrivacy;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  topics: string[];

  @OneToMany(() => CommunityResource, (r) => r.community)
  resources: CommunityResource[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
