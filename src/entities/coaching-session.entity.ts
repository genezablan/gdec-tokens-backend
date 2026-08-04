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

  // ─── Mutual-consent cancellation ────────────────────────────────────────────

  /** Who asked to cancel — set while status = PENDING_CANCELLATION. */
  @Column({ nullable: true })
  cancelRequestedById: string | null;

  @ManyToOne(() => User, { eager: false, nullable: true })
  @JoinColumn({ name: 'cancelRequestedById' })
  cancelRequestedBy: User | null;

  /** Optional note from the requester explaining why. */
  @Column({ type: 'text', nullable: true })
  cancelReason: string | null;

  /** Status to restore to if the other party declines the cancellation request. */
  @Column({ type: 'enum', enum: CoachingSessionStatus, nullable: true })
  statusBeforeCancellation: CoachingSessionStatus | null;

  // ─── Coach counter-proposal ─────────────────────────────────────────────────
  // Set while status = PENDING_EMPLOYEE_APPROVAL: the coach proposed a (new)
  // time and the employee must approve, reject, or ask for another date.
  // scheduledAt/availabilityId keep the ORIGINAL time until the proposal is
  // accepted, so the current slot stays protected by the unique index.

  /** Proposed session date, "YYYY-MM-DD". */
  @Column({ type: 'date', nullable: true })
  proposedDate: string | null;

  /** Proposed start time, "HH:MM:SS". */
  @Column({ type: 'time', nullable: true })
  proposedStartTime: string | null;

  /** Proposed end time, "HH:MM:SS". */
  @Column({ type: 'time', nullable: true })
  proposedEndTime: string | null;

  /** Optional note from the coach explaining the proposal. */
  @Column({ type: 'text', nullable: true })
  proposalNote: string | null;

  /** Optional note from the employee when asking for a different date. */
  @Column({ type: 'text', nullable: true })
  employeeProposalNote: string | null;

  /** When the employee sent the proposal back asking for another date. */
  @Column({ type: 'timestamptz', nullable: true })
  proposalReturnedAt: Date | null;

  /** Status to restore to if the proposal is withdrawn (or branch on at reject). */
  @Column({ type: 'enum', enum: CoachingSessionStatus, nullable: true })
  statusBeforeProposal: CoachingSessionStatus | null;

  // ─── Calendar sync (Outlook / Microsoft Graph) ─────────────────────────────────

  /** Microsoft Graph event id, set when the session is pushed to the coach's calendar. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  graphEventId: string | null;

  /** Teams meeting join URL for the synced calendar event. */
  @Column({ type: 'text', nullable: true })
  teamsJoinUrl: string | null;

  /** 'synced' | 'failed' | null — outcome of the last calendar push attempt. */
  @Column({ type: 'varchar', length: 20, nullable: true })
  calendarSyncStatus: string | null;

  /**
   * True when this time was accepted without being able to reach the coach's
   * Outlook — a stale token or a Graph outage. The booking is allowed through
   * (booking shouldn't depend on Microsoft's uptime), so this flag is what tells
   * the coach the slot was never checked against their calendar.
   */
  @Column({ type: 'boolean', default: false })
  outlookCheckFailed: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
