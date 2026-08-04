import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { User } from './user.entity';

@Entity('token_balances')
@Unique(['userId', 'year'])
export class TokenBalance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'int' })
  year: number;

  @Column({ type: 'int', default: 6 })
  allocated: number;

  @Column({ type: 'int', default: 0 })
  used: number;

  @Column({ type: 'int', default: 0 })
  boostTokens: number; // Additional tokens granted on top of base allocation

  /** Latest use-it-or-lose-it reminder tier sent this year: Q1 | Q2 | Q3 | OCT | NOV | FINAL. */
  @Column({ type: 'varchar', nullable: true })
  lastReminderCheckpoint: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastReminderSentAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  get remaining(): number {
    return this.allocated + this.boostTokens - this.used;
  }
}
