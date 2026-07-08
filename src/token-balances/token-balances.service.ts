import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TokenBalance } from '../entities/token-balance.entity';
import { User } from '../entities/user.entity';
import { EmployeeStatus } from '../common/enums';
import { EmailService } from '../common/services/email.service';

const TOKENS_PER_YEAR = 6;

export interface TokenBalanceSummary {
  id: string;
  userId: string;
  year: number;
  allocated: number;     // base allocation (always 6)
  boostTokens: number;   // additional tokens granted by admin
  used: number;          // tokens spent on approved requests
  remaining: number;     // allocated + boostTokens - used
}

export interface TokenDashboard {
  availableTokens: number;  // remaining (allocated + boostTokens - used)
  usedThisYear: number;     // used
  baseAllocation: number;   // allocated
  boostTokens: number;      // boostTokens
  year: number;
}

@Injectable()
export class TokenBalancesService {
  private readonly logger = new Logger(TokenBalancesService.name);

  constructor(
    @InjectRepository(TokenBalance)
    private readonly tokenBalanceRepository: Repository<TokenBalance>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly emailService: EmailService,
  ) {}

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private toSummary(balance: TokenBalance): TokenBalanceSummary {
    return {
      id: balance.id,
      userId: balance.userId,
      year: balance.year,
      allocated: balance.allocated,
      boostTokens: balance.boostTokens,
      used: balance.used,
      remaining: balance.allocated + balance.boostTokens - balance.used,
    };
  }

  private currentYear(): number {
    return new Date().getFullYear();
  }

  // ─── Core ────────────────────────────────────────────────────────────────────

  /**
   * Returns a user's balance for a given year, creating it with 6 tokens if missing.
   */
  async getOrCreate(userId: string, year: number): Promise<TokenBalance> {
    let balance = await this.tokenBalanceRepository.findOne({
      where: { userId, year },
    });

    if (!balance) {
      balance = this.tokenBalanceRepository.create({
        userId,
        year,
        allocated: TOKENS_PER_YEAR,
        used: 0,
      });
      await this.tokenBalanceRepository.save(balance);
      this.logger.log(`Created balance for user ${userId} year ${year}`);
    }

    return balance;
  }

  /**
   * Get a single balance or throw if not found.
   */
  async getBalance(userId: string, year: number): Promise<TokenBalanceSummary> {
    const balance = await this.getOrCreate(userId, year);
    return this.toSummary(balance);
  }

  /**
   * Get all yearly balances for a user (history), ordered newest first.
   */
  async getHistory(userId: string): Promise<TokenBalanceSummary[]> {
    const balances = await this.tokenBalanceRepository.find({
      where: { userId },
      order: { year: 'DESC' },
    });
    return balances.map((b) => this.toSummary(b));
  }

  /**
   * Get the 4 dashboard card values for a user for the current year.
   */
  async getDashboard(userId: string): Promise<TokenDashboard> {
    const year = this.currentYear();
    const balance = await this.getOrCreate(userId, year);
    return {
      availableTokens: balance.allocated + balance.boostTokens - balance.used,
      usedThisYear: balance.used,
      baseAllocation: balance.allocated,
      boostTokens: balance.boostTokens,
      year,
    };
  }

  // ─── Token Operations ────────────────────────────────────────────────────────

  /**
   * Admin: set the boost token amount for a specific employee/year.
   * This is an absolute assignment (not a delta). Min value is 0.
   */
  async updateBoostTokens(
    userId: string,
    year: number,
    boostTokens: number,
  ): Promise<TokenBalanceSummary> {
    const balance = await this.getOrCreate(userId, year);
    const previous = balance.boostTokens;
    balance.boostTokens = boostTokens;
    await this.tokenBalanceRepository.save(balance);
    this.logger.log(
      `Boost tokens updated for user ${userId} year ${year}: ${previous} → ${boostTokens}`,
    );

    if (previous !== boostTokens) {
      const user = await this.userRepository.findOne({ where: { id: userId } });
      if (user) {
        this.emailService
          .sendTokenBalanceAdjustedEmail({
            email: user.email,
            name: user.fullName,
            previousBoost: previous,
            updatedBoost: boostTokens,
            year,
          })
          .catch(() => {});
      }
    }

    return this.toSummary(balance);
  }

  /**
   * Admin: export all token balances for a year as CSV rows.
   */
  async exportCsvForYear(year: number): Promise<string> {
    const rows = await this.getAllForYear(year);
    const header = 'Employee ID,Name,Department,Base Allocation,Boost Tokens,Used,Available';
    const lines = rows.map((r) =>
      [
        r.employee.employeeId,
        `"${r.employee.firstName} ${r.employee.lastName}"`,
        `"${r.employee.department}"`,
        r.allocated,
        r.boostTokens,
        r.used,
        r.remaining,
      ].join(','),
    );
    return [header, ...lines].join('\n');
  }

  /**
   * Deduct tokens on request approval. Throws if insufficient balance.
   */
  async deductTokens(
    userId: string,
    year: number,
    amount: number,
  ): Promise<TokenBalanceSummary> {
    const balance = await this.getOrCreate(userId, year);
    const available = balance.allocated + balance.boostTokens - balance.used;

    if (available < amount) {
      throw new BadRequestException(
        `Insufficient token balance. Available: ${available}, Required: ${amount}`,
      );
    }

    balance.used += amount;
    await this.tokenBalanceRepository.save(balance);
    this.logger.log(
      `Deducted ${amount} token(s) from user ${userId} for year ${year}. Remaining: ${balance.allocated - balance.used}`,
    );
    return this.toSummary(balance);
  }

  /**
   * Refund tokens on request rejection or cancellation.
   */
  async refundTokens(
    userId: string,
    year: number,
    amount: number,
  ): Promise<TokenBalanceSummary> {
    const balance = await this.tokenBalanceRepository.findOne({
      where: { userId, year },
    });

    if (!balance) {
      throw new NotFoundException(
        `No token balance found for user ${userId} in year ${year}`,
      );
    }

    balance.used = Math.max(0, balance.used - amount);
    await this.tokenBalanceRepository.save(balance);
    this.logger.log(
      `Refunded ${amount} token(s) to user ${userId} for year ${year}. Used now: ${balance.used}`,
    );
    return this.toSummary(balance);
  }

  // ─── Admin ───────────────────────────────────────────────────────────────────

  /**
   * Admin: list all employee balances for a given year (with user info).
   */
  async getAllForYear(year: number): Promise<
    (TokenBalanceSummary & {
      employee: {
        employeeId: string;
        firstName: string;
        lastName: string;
        department: string;
      };
    })[]
  > {
    const balances = await this.tokenBalanceRepository.find({
      where: { year },
      relations: ['user'],
      order: { user: { lastName: 'ASC' } },
    });

    return balances.map((b) => ({
      ...this.toSummary(b),
      employee: {
        employeeId: b.user.employeeId,
        firstName: b.user.firstName,
        lastName: b.user.lastName,
        department: b.user.department,
      },
    }));
  }

  /**
   * Admin: initialize 6-token balances for all active employees for a given year.
   * Skips employees who already have a balance for that year.
   */
  async initializeYear(
    year: number,
  ): Promise<{ created: number; skipped: number }> {
    const employees = await this.userRepository.find({
      where: { employeeStatus: EmployeeStatus.REGULAR, isActive: true },
      select: ['id'],
    });

    let created = 0;
    let skipped = 0;

    for (const emp of employees) {
      const exists = await this.tokenBalanceRepository.findOne({
        where: { userId: emp.id, year },
      });

      if (exists) {
        skipped++;
      } else {
        await this.tokenBalanceRepository.save(
          this.tokenBalanceRepository.create({
            userId: emp.id,
            year,
            allocated: TOKENS_PER_YEAR,
            used: 0,
          }),
        );
        created++;
      }
    }

    this.logger.log(
      `Year ${year} initialization: ${created} created, ${skipped} skipped`,
    );
    return { created, skipped };
  }
}
