import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { DevelopmentOptionType } from '../common/enums';
import { User } from './user.entity';

@Entity('development_options')
export class DevelopmentOption {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: DevelopmentOptionType,
    unique: true,
  })
  type: DevelopmentOptionType;

  @Column({ length: 100 })
  name: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'int', default: 1 })
  tokenCost: number;

  @Column({ default: true })
  isActive: boolean;

  /**
   * Stores flexible business rules as JSON per type:
   * - task_offloading: { consecutiveYearRepeatAllowed: false }
   * - coaching:        { sessionsRequired: 3, sameCoachRequired: true }
   * - learning_subsidy: { subsidyPerToken: 1000, maxSubsidyAmount: 3000, maxTokens: 3 }
   */
  @Column({ type: 'json', nullable: true })
  rules: Record<string, unknown>;

  @Column({ nullable: true })
  formTemplateUrl: string;

  @Column({ nullable: true })
  formTemplateKey: string; // S3 object key — used to generate pre-signed download URLs

  @Column({ nullable: true })
  formTemplateFileName: string;

  @Column({ nullable: true })
  updatedById: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'updatedById' })
  updatedBy: User;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
