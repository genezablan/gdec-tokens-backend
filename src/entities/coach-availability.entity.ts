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

/**
 * Represents a single available time slot published by a coach.
 * Employees see these slots when submitting a coaching request.
 * A slot becomes `isBooked = true` once a coaching session is scheduled against it.
 */
@Entity('coach_availability')
export class CoachAvailability {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ─── Coach ────────────────────────────────────────────────────────────────────

  @Column()
  coachId: string;

  @ManyToOne(() => User, { eager: false })
  @JoinColumn({ name: 'coachId' })
  coach: User;

  // ─── Slot ─────────────────────────────────────────────────────────────────────

  /** Specific calendar date for this slot (e.g. 2026-03-10). */
  @Column({ type: 'date' })
  availableDate: string;

  /** Start time in HH:MM format (24-hour), e.g. "09:00". */
  @Column({ type: 'time' })
  startTime: string;

  /** End time in HH:MM format (24-hour), e.g. "10:00". */
  @Column({ type: 'time' })
  endTime: string;

  // ─── State ────────────────────────────────────────────────────────────────────

  /**
   * True once a coaching session has been booked for this slot.
   * A booked slot is no longer shown as available.
   */
  @Column({ type: 'boolean', default: false })
  isBooked: boolean;

  /** Coach can deactivate a slot (e.g. cancelled due to leave). */
  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
