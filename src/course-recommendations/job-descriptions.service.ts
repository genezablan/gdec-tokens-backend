import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JobDescription } from '../entities/job-description.entity';
import { UpsertJobDescriptionDto } from './dto/upsert-job-description.dto';

@Injectable()
export class JobDescriptionsService {
  constructor(
    @InjectRepository(JobDescription)
    private readonly repo: Repository<JobDescription>,
  ) {}

  findAll(): Promise<JobDescription[]> {
    return this.repo.find({ order: { position: 'ASC' } });
  }

  /**
   * Create or replace the job description for a position.
   *
   * Upsert rather than insert because a position's JD gets revised, and the
   * unique constraint on `position` is what keeps one role from accumulating
   * competing descriptions. Editing the text does NOT clear existing
   * recommendations — a stale set is more useful than none while the next
   * generation run catches up.
   */
  async upsert(dto: UpsertJobDescriptionDto): Promise<JobDescription> {
    const position = dto.position.trim();
    const existing = await this.repo.findOne({ where: { position } });

    if (existing) {
      existing.content = dto.content.trim();
      existing.source = dto.source?.trim() ?? existing.source;
      return this.repo.save(existing);
    }

    return this.repo.save(
      this.repo.create({
        position,
        content: dto.content.trim(),
        source: dto.source?.trim() ?? 'manual',
      }),
    );
  }
}
