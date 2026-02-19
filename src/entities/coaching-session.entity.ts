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
import { TokenRequest } from './token-request.entity';
import { CoachAvailability } from './coach-availability.entity';
import { CoachingSessionStatus } from '../common/enums';

/**
 * Represents one of the 3 coaching sessions in a coaching cycle.
 * Sessions are booked AFTER the token request is approved (status = approved).
 * A cycle is complete when all 3 sessions reach status = completed.
 */
@Entity('coaching_sessions')
export class CoachingSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ─── Parent Request ───────────────────────────────────────────────────────────

  @Column()
  tokenRequestId: string;

  @ManyToOne(() => TokenRequest, { eager: false })
  @JoinColumn({ name: 'tokenRequestId' })
  tokenRequest: TokenRequest;

  // ─── Participants ─────────────────────────────────────────────────────────────

  @Column()
  coachId: string;

  @ManyToOne(() => User, { eager: false })
  @JoinColumn({ name: 'coachId' })
  coach: User;

  @Column()
  employeeId: string;

  @ManyToOne(() => User, { eager: false })
  @JoinColumn({ name: 'employeeId' })
  employee: User;

  // ─── Availability Slot ────────────────────────────────────────────────────────

  /** The coach availability slot this session was booked against. */
  @Column({ nullable: true })
  availabilityId: string | null;

  @ManyToOne(() => CoachAvailability, { eager: false, nullable: true })
  @JoinColumn({ name: 'availabilityId' })
  availability: CoachAvailability | null;

  // ─── Session Details ──────────────────────────────────────────────────────────

  /** 1, 2, or 3 — identifies which session in the 3-session cycle. */
  @Column({ type: 'int' })
  sessionNumber: number;

  /** Exact date and time the session is scheduled for. */
  @Column({ type: 'timestamptz' })
  scheduledAt: Date;

  @Column({
    type: 'enum',
    enum: CoachingSessionStatus,
    default: CoachingSessionStatus.SCHEDULED,
  })
  status: CoachingSessionStatus;

  /** Set by the coach when marking the session as completed. */
  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  /** Optional post-session notes from the coach. */
  @Column({ type: 'text', nullable: true })
  sessionNotes: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
