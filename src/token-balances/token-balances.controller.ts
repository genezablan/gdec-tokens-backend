import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  Res,
  ParseUUIDPipe,
  ParseIntPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import { TokenBalancesService } from './token-balances.service';
import { TokenReminderService } from './token-reminder.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { User } from '../entities/user.entity';
import { UserRole } from '../common/enums';
import { InitializeYearDto } from './dto/initialize-year.dto';
import { UpdateBoostTokensDto } from './dto/update-boost-tokens.dto';

@Controller('token-balances')
export class TokenBalancesController {
  constructor(
    private readonly tokenBalancesService: TokenBalancesService,
    private readonly tokenReminderService: TokenReminderService,
  ) {}

  /**
   * GET /token-balances/me/dashboard
   * Returns the 4 summary cards for the employee dashboard.
   */
  @Get('me/dashboard')
  getMyDashboard(@CurrentUser() user: User) {
    return this.tokenBalancesService.getDashboard(user.id);
  }

  /**
   * GET /token-balances/me
   * Current user's balance for the current year.
   */
  @Get('me')
  getMyBalance(@CurrentUser() user: User) {
    return this.tokenBalancesService.getBalance(
      user.id,
      new Date().getFullYear(),
    );
  }

  /**
   * GET /token-balances/me/history
   * Current user's balance summary for all years.
   */
  @Get('me/history')
  getMyHistory(@CurrentUser() user: User) {
    return this.tokenBalancesService.getHistory(user.id);
  }

  /**
   * GET /token-balances/me/:year
   * Current user's balance for a specific year.
   */
  @Get('me/:year')
  getMyBalanceForYear(
    @CurrentUser() user: User,
    @Param('year', ParseIntPipe) year: number,
  ) {
    return this.tokenBalancesService.getBalance(user.id, year);
  }

  /**
   * GET /token-balances
   * Admin: all employee balances for a given year (defaults to current year).
   */
  @Get()
  @Roles(UserRole.ADMIN)
  getAllForYear(
    @Query('year', new ParseIntPipe({ optional: true })) year?: number,
  ) {
    return this.tokenBalancesService.getAllForYear(
      year ?? new Date().getFullYear(),
    );
  }

  /**
   * GET /token-balances/export
   * Admin: download all employee token balances for a year as CSV.
   *
   * NOTE: This static route MUST be declared before the parametric
   * `:userId` routes below. NestJS matches routes in declaration order,
   * so if `:userId` comes first, `/export` is captured as a userId and
   * rejected by ParseUUIDPipe (400), breaking the CSV download.
   */
  @Get('export')
  @Roles(UserRole.ADMIN)
  async exportCsv(
    @Query('year', new ParseIntPipe({ optional: true })) year: number | undefined,
    @Res() res: Response,
  ) {
    const targetYear = year ?? new Date().getFullYear();
    const csv = await this.tokenBalancesService.exportCsvForYear(targetYear);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="token-balances-${targetYear}.csv"`,
    );
    res.send(csv);
  }

  /**
   * GET /token-balances/:userId
   * Admin/Approver: a specific employee's balance for the current year.
   */
  @Get(':userId')
  @Roles(UserRole.ADMIN, UserRole.APPROVER)
  getEmployeeBalance(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.tokenBalancesService.getBalance(
      userId,
      new Date().getFullYear(),
    );
  }

  /**
   * GET /token-balances/:userId/history
   * Admin/Approver: a specific employee's balance history across all years.
   */
  @Get(':userId/history')
  @Roles(UserRole.ADMIN, UserRole.APPROVER)
  getEmployeeHistory(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.tokenBalancesService.getHistory(userId);
  }

  /**
   * PATCH /token-balances/:userId/boost
   * Admin: set the boost token amount for a specific employee (current year).
   * Body: { boostTokens: number } — absolute value, not a delta.
   */
  @Patch(':userId/boost')
  @Roles(UserRole.ADMIN)
  updateBoostTokens(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query('year', new ParseIntPipe({ optional: true })) year: number | undefined,
    @Body() dto: UpdateBoostTokensDto,
  ) {
    return this.tokenBalancesService.updateBoostTokens(
      userId,
      year ?? new Date().getFullYear(),
      dto.boostTokens,
    );
  }

  /**
   * POST /token-balances/initialize
   * Admin: seed 6-token balances for all active employees for a given year.
   */
  @Post('initialize')
  @Roles(UserRole.ADMIN)
  initializeYear(@Body() dto: InitializeYearDto) {
    return this.tokenBalancesService.initializeYear(dto.year);
  }

  /**
   * POST /token-balances/reminders/run
   * Admin: manually run the use-it-or-lose-it reminder check for today's tier,
   * instead of waiting for the daily cron. Safe to call more than once — anyone
   * already caught up to the current tier is skipped.
   */
  @Post('reminders/run')
  @Roles(UserRole.ADMIN)
  runReminders() {
    return this.tokenReminderService.runNow();
  }
}
