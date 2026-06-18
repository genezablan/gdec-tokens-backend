import { Controller, Get, Query } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../common/enums';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  /**
   * GET /analytics/development-tokens?year=2026
   * Admin-only. Powers the "Development Token" analytics dashboard.
   * Year defaults to the current year when omitted.
   */
  @Get('development-tokens')
  @Roles(UserRole.ADMIN)
  getDevelopmentTokenAnalytics(@Query() query: AnalyticsQueryDto) {
    return this.analyticsService.getDevelopmentTokenAnalytics(query.year);
  }
}
