import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { CourseRecommendationsService } from './course-recommendations.service';
import { JobDescriptionsService } from './job-descriptions.service';
import { UpsertJobDescriptionDto } from './dto/upsert-job-description.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { User } from '../entities/user.entity';
import { UserRole } from '../common/enums';

@Controller('course-recommendations')
export class CourseRecommendationsController {
  private readonly logger = new Logger(CourseRecommendationsController.name);

  constructor(
    private readonly recommendations: CourseRecommendationsService,
    private readonly jobDescriptions: JobDescriptionsService,
  ) {}

  /**
   * GET /course-recommendations/me
   * Suggestions for the signed-in employee's own position. Empty array when
   * their position has no job description yet — not an error.
   */
  @Get('me')
  getMine(@CurrentUser() user: User) {
    return this.recommendations.getForPosition(user.position);
  }

  /**
   * GET /course-recommendations/coverage
   * Admin: which positions have a job description and generated courses, and
   * which are still missing, ordered by how many employees they affect.
   */
  @Get('coverage')
  @Roles(UserRole.ADMIN)
  getCoverage() {
    return this.recommendations.coverage();
  }

  /**
   * POST /course-recommendations/job-descriptions
   * Admin: create or replace the job description for a position.
   */
  @Post('job-descriptions')
  @Roles(UserRole.ADMIN)
  upsertJobDescription(@Body() dto: UpsertJobDescriptionDto) {
    return this.jobDescriptions.upsert(dto);
  }

  /**
   * POST /course-recommendations/generate?onlyMissing=true
   * Admin: start a generation run over the stored job descriptions.
   *
   * Deliberately fire-and-forget. One position takes around 70 seconds of web
   * search, so even a single role exceeds CloudFront's origin timeout and a
   * full 150-role batch runs for hours. The request returns 202 immediately;
   * progress is visible in the server log and through /coverage.
   */
  @Post('generate')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.ACCEPTED)
  startGeneration(@Query('onlyMissing') onlyMissing?: string) {
    const scope = onlyMissing !== 'false';
    void this.recommendations
      .regenerateAll({ onlyMissing: scope })
      .then(({ generated, failed }) =>
        this.logger.log(
          `Generation run finished: ${generated} generated, ${failed.length} failed.`,
        ),
      )
      .catch((err: unknown) =>
        this.logger.error(
          `Generation run aborted: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );

    return {
      started: true,
      scope: scope ? 'positions without recommendations' : 'all positions',
      message:
        'Generation runs in the background. Poll /course-recommendations/coverage for progress.',
    };
  }
}
