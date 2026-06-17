import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ResourceType } from '../common/enums';
import { Community } from './community.entity';

/**
 * A pinned resource link shown on a community's About tab.
 * docs/community.md §3.6, §12 (`community_resources`).
 */
@Entity('community_resources')
@Index(['communityId'])
export class CommunityResource {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  communityId: string;

  @ManyToOne(() => Community, (c) => c.resources, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'communityId' })
  community: Community;

  @Column({ type: 'enum', enum: ResourceType })
  type: ResourceType;

  @Column({ length: 150 })
  label: string;

  @Column({ type: 'varchar', length: 1000 })
  url: string;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;
}
