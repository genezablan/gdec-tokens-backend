import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';

/**
 * One row per successful login. Powers the "User Activity and Engagement"
 * analytics panel (daily-active, average sessions, returning users).
 *
 * Kept as an append-only event log rather than a counter on User so we can
 * compute time-windowed metrics (e.g. "active in the last 24h").
 */
@Entity('login_events')
@Index(['userId', 'createdAt'])
export class LoginEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @CreateDateColumn()
  @Index()
  createdAt: Date;

  /** Timestamp of the most recent heartbeat ping for this login session. */
  @Column({ type: 'timestamptz', nullable: true })
  lastHeartbeatAt: Date | null;

  /**
   * Accumulated session duration in seconds, built up from consecutive
   * heartbeat pings. Stops accumulating once the gap between two heartbeats
   * exceeds the idle threshold (see AuthService.heartbeat).
   */
  @Column({ type: 'int', default: 0 })
  durationSeconds: number;
}
