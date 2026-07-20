import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { UserRole, EmployeeType, EmployeeStatus, Gender, AuthProvider } from '../common/enums';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true, length: 20 })
  employeeId: string;

  @Column({ unique: true, length: 100 })
  email: string;

  @Column({ nullable: true })
  @Exclude()
  password: string;

  @Column({
    type: 'enum',
    enum: AuthProvider,
    default: AuthProvider.LOCAL,
  })
  authProvider: AuthProvider;

  @Column({ nullable: true })
  @Exclude()
  providerId: string;

  @Column({ length: 50 })
  firstName: string;

  @Column({ length: 50, nullable: true })
  middleName: string;

  @Column({ length: 50 })
  lastName: string;

  @Column({
    type: 'enum',
    enum: Gender,
    nullable: true,
  })
  gender: Gender | null;

  @Column({ length: 100 })
  department: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  location: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  position: string | null;

  @Column({
    type: 'enum',
    enum: EmployeeType,
    default: EmployeeType.RANK_AND_FILE,
  })
  employeeType: EmployeeType;

  @Column({
    type: 'enum',
    enum: EmployeeStatus,
    default: EmployeeStatus.REGULAR,
  })
  employeeStatus: EmployeeStatus;

  @Column({ nullable: true })
  immediateSupervisorId: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'immediateSupervisorId' })
  immediateSupervisor: User;

  @Column({ length: 50, nullable: true })
  contact: string;

  @Column({ type: 'date', nullable: true })
  separationDate: Date;

  @Column({
    type: 'enum',
    enum: UserRole,
    array: true,
    default: [UserRole.EMPLOYEE],
  })
  roles: UserRole[];

  @Column({ default: true })
  isActive: boolean;

  @Column({ default: false })
  isPasswordChanged: boolean;

  @Column({ default: false })
  isPendingApproval: boolean;

  @Column({ type: 'varchar', nullable: true, length: 500 })
  profilePicture: string | null;

  @Column({ type: 'varchar', nullable: true, length: 50 })
  nickname: string | null;

  // ─── Coach profile ──────────────────────────────────────────────────────────
  // Populated for users with the `coach` role; null for everyone else.

  @Column({ type: 'varchar', nullable: true, length: 120 })
  headline: string | null;

  @Column({ type: 'text', nullable: true })
  bio: string | null;

  @Column({ type: 'text', array: true, nullable: true })
  specialties: string[] | null;

  @Column({ type: 'int', nullable: true })
  yearsExperience: number | null;

  /** Max number of coachees this coach will take on per coaching cycle. */
  @Column({ type: 'int', nullable: true })
  maxCoachesPerCycle: number | null;

  // ─── Coaching availability (Outlook is the source of truth for free time) ──────
  // Bookable slots are generated from this window minus the coach's Outlook busy
  // times. Null until the coach configures their coaching hours.

  /**
   * Per-day coaching windows, e.g. [{ day: 1, startTime: "09:00", endTime: "12:00" }].
   * `day` is 0=Sun … 6=Sat. A day may have several non-overlapping windows.
   */
  @Column({ type: 'jsonb', nullable: true })
  coachingWeeklyHours: { day: number; startTime: string; endTime: string }[] | null;

  /** Length of one coaching session in minutes (slot granularity). */
  @Column({ type: 'int', nullable: true })
  coachingSessionMinutes: number | null;

  @Column({ nullable: true, length: 255 })
  @Exclude()
  passwordResetToken: string;

  @Column({ type: 'timestamptz', nullable: true })
  @Exclude()
  passwordResetExpiry: Date;

  /** Timestamp of the user's most recent successful login. Powers engagement analytics. */
  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  get fullName(): string {
    return `${this.firstName} ${this.middleName ? this.middleName + ' ' : ''}${this.lastName}`;
  }

  hasRole(role: UserRole): boolean {
    return this.roles.includes(role);
  }

  canApprove(): boolean {
    return this.roles.includes(UserRole.APPROVER) || this.roles.includes(UserRole.ADMIN);
  }

  isCoach(): boolean {
    return this.roles.includes(UserRole.COACH);
  }

  isAdmin(): boolean {
    return this.roles.includes(UserRole.ADMIN);
  }
}
