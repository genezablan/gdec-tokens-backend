import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { JobDescription } from '../entities/job-description.entity';
import { CourseRecommendation } from '../entities/course-recommendation.entity';
import { TokenRequest } from '../entities/token-request.entity';
import { DevelopmentOptionType, RequestStatus } from '../common/enums';
import { CourseGeneratorService } from './course-generator.service';

/** What a colleague actually paid for a course, read back out of approved requests. */
export interface PeerPrice {
  amountPhp: number;
  tokenCost: number;
  paidAt: Date;
  timesPurchased: number;
}

export interface RecommendationView extends CourseRecommendation {
  peerPrice: PeerPrice | null;
}

@Injectable()
export class CourseRecommendationsService {
  private readonly logger = new Logger(CourseRecommendationsService.name);

  constructor(
    @InjectRepository(JobDescription)
    private readonly jobDescriptionRepo: Repository<JobDescription>,
    @InjectRepository(CourseRecommendation)
    private readonly recommendationRepo: Repository<CourseRecommendation>,
    @InjectRepository(TokenRequest)
    private readonly tokenRequestRepo: Repository<TokenRequest>,
    private readonly generator: CourseGeneratorService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Cached recommendations for a position, each with the real price a colleague
   * paid when one is known.
   *
   * Returns an empty array rather than throwing when the position has no job
   * description: most positions will not have one on day one, and the UI simply
   * shows nothing rather than an error.
   */
  async getForPosition(position: string | null): Promise<RecommendationView[]> {
    if (!position) return [];

    const jd = await this.jobDescriptionRepo.findOne({ where: { position } });
    if (!jd) return [];

    const recommendations = await this.recommendationRepo.find({
      where: { jobDescriptionId: jd.id },
      order: { rank: 'ASC' },
    });
    if (recommendations.length === 0) return [];

    const peerPrices = await this.peerPrices(
      recommendations.map((r) => r.title),
    );

    return recommendations.map((r) => ({
      ...r,
      peerPrice: peerPrices.get(r.title.toLowerCase()) ?? null,
    }));
  }

  /**
   * What colleagues actually paid, keyed by lower-cased course title.
   *
   * This is the only source of real peso figures in the feature. Udemy renders
   * prices in JavaScript and the Udemy Affiliate API was discontinued on
   * 2025-01-01, so nothing can query a live price — but employees type the real
   * amount into every Learning Subsidy request, and approved requests are
   * therefore a record of what these courses cost in this market.
   *
   * Matched on title because token_requests stores the course as free text in
   * `formData`, with no link back to the recommendation that suggested it.
   * Titles are pre-filled from the recommendation, so exact matches are the
   * common case; a retyped title simply misses and falls back to the estimate.
   */
  private async peerPrices(titles: string[]): Promise<Map<string, PeerPrice>> {
    if (titles.length === 0) return new Map();

    // `formData` must be quoted by hand: TypeORM only rewrites a bare
    // `alias.property` path, so an unquoted r.formData->>'x' reaches Postgres
    // as the non-existent lower-cased `r.formdata`.
    const rows = await this.tokenRequestRepo
      .createQueryBuilder('r')
      .select(`lower(trim(r."formData"->>'courseName'))`, 'title')
      .addSelect(`max((r."formData"->>'subsidyAmount')::numeric)`, 'amount')
      .addSelect('max(r."createdAt")', 'paidAt')
      .addSelect('count(*)', 'purchases')
      .where('r.type = :type', { type: DevelopmentOptionType.LEARNING_SUBSIDY })
      .andWhere('r.status = :status', { status: RequestStatus.APPROVED })
      .andWhere(`r."formData"->>'courseName' IS NOT NULL`)
      .andWhere(`lower(trim(r."formData"->>'courseName')) IN (:...titles)`, {
        titles: titles.map((t) => t.trim().toLowerCase()),
      })
      .groupBy('title')
      .getRawMany<{
        title: string;
        amount: string | null;
        paidAt: string;
        purchases: string;
      }>();

    const map = new Map<string, PeerPrice>();
    for (const row of rows) {
      const amountPhp = Number(row.amount);
      if (!Number.isFinite(amountPhp) || amountPhp <= 0) continue;
      map.set(row.title, {
        amountPhp,
        tokenCost: Math.ceil(amountPhp / 1000),
        paidAt: new Date(row.paidAt),
        timesPurchased: Number(row.purchases),
      });
    }
    return map;
  }

  /**
   * Regenerate one job description's recommendations, replacing what is there.
   *
   * Old rows are deleted and new ones written in a single transaction, so a
   * failed generation leaves the previous set intact rather than emptying the
   * position. A run that yields nothing usable is treated as a failure for the
   * same reason.
   */
  async regenerate(jobDescriptionId: string): Promise<number> {
    const jd = await this.jobDescriptionRepo.findOne({
      where: { id: jobDescriptionId },
    });
    if (!jd) {
      throw new NotFoundException('Job description not found');
    }

    const courses = await this.generator.generate(jd);
    if (courses.length === 0) {
      throw new Error(
        `Generation produced no usable courses for "${jd.position}" — keeping the previous set`,
      );
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.delete(CourseRecommendation, {
        jobDescriptionId: jd.id,
      });
      await manager.insert(
        CourseRecommendation,
        courses.map((course, index) => ({
          ...course,
          jobDescriptionId: jd.id,
          rank: index,
          generatedByModel: this.generator.modelName,
        })),
      );
    });

    this.logger.log(
      `Stored ${courses.length} recommendation(s) for "${jd.position}"`,
    );
    return courses.length;
  }

  /**
   * Regenerate every job description that has none yet, or all of them.
   *
   * Sequential on purpose: each run makes up to eight web searches, and firing
   * 150 of those concurrently would hit rate limits and produce a batch that is
   * mostly retries. One failure is logged and skipped rather than aborting the
   * rest — a batch over 150 roles should not be lost to one bad position.
   */
  async regenerateAll(options: { onlyMissing?: boolean } = {}): Promise<{
    generated: number;
    failed: { position: string; reason: string }[];
  }> {
    const all = await this.jobDescriptionRepo.find({
      order: { position: 'ASC' },
    });

    let targets = all;
    if (options.onlyMissing) {
      const counts = await this.recommendationRepo
        .createQueryBuilder('c')
        .select('c.jobDescriptionId', 'id')
        .groupBy('c.jobDescriptionId')
        .getRawMany<{ id: string }>();
      const has = new Set(counts.map((c) => c.id));
      targets = all.filter((jd) => !has.has(jd.id));
    }

    let generated = 0;
    const failed: { position: string; reason: string }[] = [];

    for (const [i, jd] of targets.entries()) {
      this.logger.log(
        `[${i + 1}/${targets.length}] Generating for "${jd.position}"…`,
      );
      try {
        await this.regenerate(jd.id);
        generated++;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Failed for "${jd.position}": ${reason}`);
        failed.push({ position: jd.position, reason });
      }
    }

    return { generated, failed };
  }

  /** Positions that have employees but no job description yet. */
  async coverage(): Promise<{
    positionsWithEmployees: number;
    withJobDescription: number;
    withRecommendations: number;
    missing: { position: string; employees: number }[];
  }> {
    const rows = await this.dataSource.query<
      {
        position: string;
        employees: string;
        has_jd: boolean;
        has_recs: boolean;
      }[]
    >(`
      SELECT u.position,
             count(*)::text AS employees,
             (jd.id IS NOT NULL) AS has_jd,
             (jd.id IS NOT NULL AND EXISTS (
                SELECT 1 FROM course_recommendations c WHERE c."jobDescriptionId" = jd.id
             )) AS has_recs
      FROM users u
      LEFT JOIN job_descriptions jd ON jd.position = u.position
      WHERE u."isActive" AND u.position IS NOT NULL
      GROUP BY u.position, jd.id
      ORDER BY count(*) DESC
    `);

    return {
      positionsWithEmployees: rows.length,
      withJobDescription: rows.filter((r) => r.has_jd).length,
      withRecommendations: rows.filter((r) => r.has_recs).length,
      missing: rows
        .filter((r) => !r.has_jd)
        .map((r) => ({ position: r.position, employees: Number(r.employees) })),
    };
  }
}
