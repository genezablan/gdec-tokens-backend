import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { CourseRecommendation } from './course-recommendation.entity';

/**
 * A job description, keyed on job title rather than on the employee.
 *
 * 404 active employees share only 150 distinct positions — 63 of them are
 * Fulfillment Associates — so per-employee JDs would mean uploading the same
 * document dozens of times and paying for dozens of identical AI runs that
 * produce identical recommendations. Keying on position means one upload and
 * one generation per role, and a new hire inherits recommendations the moment
 * their `users.position` matches.
 */
@Entity('job_descriptions')
export class JobDescription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Matches `users.position`. Stored exactly as the position appears on the
   * user record so the join is a plain equality — normalise on the way in, not
   * at query time.
   */
  @Column({ type: 'varchar', length: 100, unique: true })
  position: string;

  /** The job description text the recommender reasons over. */
  @Column({ type: 'text' })
  content: string;

  /** Where this came from — spreadsheet name, document filename, or 'manual'. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  source: string | null;

  @OneToMany(() => CourseRecommendation, (r) => r.jobDescription)
  recommendations: CourseRecommendation[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
