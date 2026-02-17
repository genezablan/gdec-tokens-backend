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
  })
  gender: Gender;

  @Column({ length: 100 })
  department: string;

  @Column({ length: 50 })
  location: string;

  @Column({ length: 100 })
  position: string;

  @Column({
    type: 'enum',
    enum: EmployeeType,
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
