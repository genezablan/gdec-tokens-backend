import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { CourseProvider, CoursePricingModel } from '../common/enums';
import { JobDescription } from './job-description.entity';

/**
 * One AI-generated course suggestion for a job description.
 *
 * Generated in batches and cached, never on request: a single run takes ~70
 * seconds of web search, so generating on page load would be both slow and
 * wasteful when 63 people share a position.
 *
 * There is deliberately no verified price column. Udemy renders prices in
 * JavaScript so neither search nor a page fetch can read one, and the Udemy
 * Affiliate API — the only programmatic source — was discontinued on
 * 2025-01-01. What the model reports is an estimate; real peso figures come
 * from what colleagues actually paid, read back out of approved token requests.
 */
@Entity('course_recommendations')
@Unique(['jobDescriptionId', 'url'])
@Index(['jobDescriptionId', 'rank'])
export class CourseRecommendation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  jobDescriptionId: string;

  @ManyToOne(() => JobDescription, (jd) => jd.recommendations, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'jobDescriptionId' })
  jobDescription: JobDescription;

  @Column({ type: 'enum', enum: CourseProvider })
  provider: CourseProvider;

  @Column({ type: 'varchar', length: 300 })
  title: string;

  @Column({ type: 'varchar', length: 500 })
  url: string;

  @Column({ type: 'varchar', length: 60, nullable: true })
  level: string | null;

  @Column({ type: 'int', nullable: true })
  durationHours: number | null;

  /** Why this course suits this specific role — the most valuable field to a reader. */
  @Column({ type: 'text' })
  whyItFits: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  skillTargeted: string | null;

  @Column({
    type: 'enum',
    enum: CoursePricingModel,
    default: CoursePricingModel.ONE_TIME,
  })
  pricingModel: CoursePricingModel;

  /**
   * The model's expectation of token cost, NOT a quoted price. Null when it had
   * no basis to estimate. Never present this to an employee as the real cost.
   */
  @Column({ type: 'int', nullable: true })
  estimatedTokenCost: number | null;

  /** The model's own caveat about pricing, shown verbatim under the estimate. */
  @Column({ type: 'text', nullable: true })
  priceNote: string | null;

  /** Display order within a job description, best fit first. */
  @Column({ type: 'int', default: 0 })
  rank: number;

  /** Which model produced this, so a bad batch can be identified and re-run. */
  @Column({ type: 'varchar', length: 60 })
  generatedByModel: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
