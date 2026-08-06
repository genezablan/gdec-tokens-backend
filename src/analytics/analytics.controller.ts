import { Controller, Get, Query } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { ExecutiveAnalyticsService } from './executive-analytics.service';
import { DepartmentAnalyticsService } from './department-analytics.service';
import { ManagerAnalyticsService } from './manager-analytics.service';
import { EmployeeAnalyticsService } from './employee-analytics.service';
import { AnalyticsFiltersDto } from './dto/analytics-filters.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../common/enums';

/**
 * Admin analytics dashboard, one endpoint per tab plus the shared filter
 * options. All endpoints accept the same optional filter set
 * (year, month, department, managerId, employeeId).
 */
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly executiveAnalytics: ExecutiveAnalyticsService,
    private readonly departmentAnalytics: DepartmentAnalyticsService,
    private readonly managerAnalytics: ManagerAnalyticsService,
    private readonly employeeAnalytics: EmployeeAnalyticsService,
  ) {}

  /** GET /analytics/filters — dropdown options for the FilterBar. */
  @Get('filters')
  @Roles(UserRole.ADMIN)
  getFilterOptions() {
    return this.analyticsService.getFilterOptions();
  }

  /** GET /analytics/executive — Executive Overview tab. */
  @Get('executive')
  @Roles(UserRole.ADMIN)
  getExecutive(@Query() filters: AnalyticsFiltersDto) {
    return this.executiveAnalytics.getExecutive(filters);
  }

  /** GET /analytics/departments — Department Analytics tab. */
  @Get('departments')
  @Roles(UserRole.ADMIN)
  getDepartments(@Query() filters: AnalyticsFiltersDto) {
    return this.departmentAnalytics.getDepartments(filters);
  }

  /** GET /analytics/managers — People Manager Analytics tab. */
  @Get('managers')
  @Roles(UserRole.ADMIN)
  getManagers(@Query() filters: AnalyticsFiltersDto) {
    return this.managerAnalytics.getManagers(filters);
  }

  /**
   * GET /analytics/employees — Employee Analytics tab.
   * Returns the roster, or a single-employee profile when employeeId is set.
   */
  @Get('employees')
  @Roles(UserRole.ADMIN)
  getEmployees(@Query() filters: AnalyticsFiltersDto) {
    return this.employeeAnalytics.getEmployees(filters);
  }
}
