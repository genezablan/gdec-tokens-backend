import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';
import { DevelopmentOption } from './development-option.entity';
import { DevelopmentOptionType, RequestStatus } from '../common/enums';

@Entity('token_requests')
export class TokenRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ─── Submitter ────────────────────────────────────────────────────────────────

  @Column()
  employeeId: string;

  @ManyToOne(() => User, { eager: false })
  @JoinColumn({ name: 'employeeId' })
  employee: User;

  // ─── Development Option Snapshot ──────────────────────────────────────────────

  @Column()
  developmentOptionId: string;

  @ManyToOne(() => DevelopmentOption, { eager: false })
  @JoinColumn({ name: 'developmentOptionId' })
  developmentOption: DevelopmentOption;

  /**
   * Snapshot of the option type at submission time.
   * Not affected by admin changes to development_options.
   */
  @Column({ type: 'enum', enum: DevelopmentOptionType })
  type: DevelopmentOptionType;

  /**
   * Snapshot of tokenCost at submission time.
   * Ensures admin changes don't affect existing requests.
   */
  @Column({ type: 'int' })
  tokenCost: number;

  /** Year the tokens will be deducted from (e.g. 2026). */
  @Column({ type: 'int' })
  year: number;

  // ─── Status ───────────────────────────────────────────────────────────────────

  @Column({
    type: 'enum',
    enum: RequestStatus,
    default: RequestStatus.PENDING,
  })
  status: RequestStatus;

  // ─── Manager Approval ─────────────────────────────────────────────────────────

  /** Resolved from employee.immediateSupervisorId at submission time. */
  @Column({ nullable: true })
  managerId: string;

  @ManyToOne(() => User, { eager: false, nullable: true })
  @JoinColumn({ name: 'managerId' })
  manager: User;

  @Column({ type: 'timestamptz', nullable: true })
  managerApprovedAt: Date;

  // ─── Employee Info Snapshot ───────────────────────────────────────────────────

  /**
   * These fields are snapshotted from the employee's profile at submission time.
   * They do NOT change if the employee is later transferred or promoted.
   */
  @Column({ length: 100, nullable: true })
  snapshotDepartment: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  snapshotPosition: string | null;

  @Column({ length: 101, nullable: true })
  snapshotManagerName: string; // "First Last" of manager at submission time

  // ─── HR Approval ──────────────────────────────────────────────────────────────

  /** HR user who performed the final approval. Set at hr-approve time. */
  @Column({ nullable: true })
  hrId: string;

  @ManyToOne(() => User, { eager: false, nullable: true })
  @JoinColumn({ name: 'hrId' })
  hr: User;

  @Column({ type: 'timestamptz', nullable: true })
  hrApprovedAt: Date;

  // ─── Rejection ────────────────────────────────────────────────────────────────

  @Column({ nullable: true })
  rejectedById: string;

  @ManyToOne(() => User, { eager: false, nullable: true })
  @JoinColumn({ name: 'rejectedById' })
  rejectedBy: User;

  /** Which level rejected: 'manager' | 'hr' */
  @Column({ nullable: true, length: 20 })
  rejectedByLevel: string;

  @Column({ type: 'text', nullable: true })
  rejectionComment: string;

  @Column({ type: 'timestamptz', nullable: true })
  rejectedAt: Date;

  // ─── Cancellation ─────────────────────────────────────────────────────────────

  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt: Date;

  // ─── Request-specific form data ──────────────────────────────────────────────

  /**
   * Flexible JSON payload — shape varies by type:
   * task_offloading:  { projectName, projectDescription, ojt? }
   * coaching:         { coachId, coachName }
   * learning_subsidy: { courseName, provider, subsidyAmount, tokenCost }
   */
  @Column({ type: 'jsonb', nullable: true })
  formData: Record<string, unknown>;

  /** Optional S3 URL for supporting attachment. */
  @Column({ nullable: true })
  attachmentUrl: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
