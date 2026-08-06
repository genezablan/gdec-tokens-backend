import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('tutorials')
export class Tutorial {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 200 })
  title: string;

  /** Small label shown above the title in the Video Guide (e.g. "Quick Start Tutorials"). */
  @Column({ length: 100 })
  category: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  /**
   * S3 object key for the video file — used to generate pre-signed playback URLs.
   * Nullable so a tutorial record can be created before its video is uploaded.
   */
  @Column({ nullable: true })
  videoKey: string;

  /** S3 object key for the thumbnail image — used to generate pre-signed URLs. */
  @Column({ nullable: true })
  thumbnailKey: string;

  /** Total length in seconds (e.g. 572 → "9:32" on the frontend). */
  @Column({ type: 'int', nullable: true })
  durationSeconds: number;

  /** Controls card ordering in the Video Guide. */
  @Column({ type: 'int', default: 0 })
  displayOrder: number;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
