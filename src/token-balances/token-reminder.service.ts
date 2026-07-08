import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TokenBalance } from '../entities/token-balance.entity';
import { EmailService, TokenReminderCheckpoint } from '../common/services/email.service';

/** Reminder tiers in calendar order — index comparisons below rely on this ordering. */
const TIER_ORDER: TokenReminderCheckpoint[] = ['Q1', 'Q2', 'Q3', 'OCT', 'NOV', 'FINAL'];

const CHECKPOINTS: { tier: TokenReminderCheckpoint; month: number; day: number }[] = [
  { tier: 'Q1', month: 3, day: 1 },
  { tier: 'Q2', month: 6, day: 1 },
  { tier: 'Q3', month: 9, day: 1 },
  { tier: 'OCT', month: 10, day: 1 },
  { tier: 'NOV', month: 11, day: 1 },
  { tier: 'FINAL', month: 12, day: 15 },
];

/**
 * The latest reminder tier whose target date has passed this year, or null before March 1.
 * A "latest passed" check (rather than an exact-date match) makes catch-up automatic if the
 * job doesn't run on the exact checkpoint day.
 */
export function determineDueTier(today: Date): TokenReminderCheckpoint | null {
  const monthDay = (today.getMonth() + 1) * 100 + today.getDate();
  let due: TokenReminderCheckpoint | null = null;
  for (const cp of CHECKPOINTS) {
    if (monthDay >= cp.month * 100 + cp.day) due = cp.tier;
  }
  return due;
}

/**
 * Daily use-it-or-lose-it reminder for employees with an unused Development Token
 * balance. Tokens don't roll over, so each employee gets at most one email per
 * tier per year — progress is tracked on their TokenBalance row and resets
 * naturally each January since a new row is created per year.
 */
@Injectable()
export class TokenReminderService {
  private readonly logger = new Logger(TokenReminderService.name);

  constructor(
    @InjectRepository(TokenBalance)
    private readonly tokenBalanceRepository: Repository<TokenBalance>,
    private readonly emailService: EmailService,
  ) {}

  @Cron('0 8 * * *', { timeZone: 'Asia/Manila' })
  async handleDailyCheck(): Promise<void> {
    await this.runNow();
  }

  /** Sends the currently-due tier's reminder to anyone behind it. Safe to call more than once a day. */
  async runNow(): Promise<{ sent: number }> {
    const today = new Date();
    const dueTier = determineDueTier(today);
    if (!dueTier) return { sent: 0 };

    const dueIndex = TIER_ORDER.indexOf(dueTier);
    const year = today.getFullYear();

    const balances = await this.tokenBalanceRepository.find({
      where: { year },
      relations: ['user'],
    });

    let sent = 0;
    for (const balance of balances) {
      if (!balance.user?.isActive) continue;
      if (balance.remaining <= 0) continue;

      const currentIndex = balance.lastReminderCheckpoint
        ? TIER_ORDER.indexOf(balance.lastReminderCheckpoint as TokenReminderCheckpoint)
        : -1;
      if (currentIndex >= dueIndex) continue;

      try {
        await this.emailService.sendTokenUsageReminderEmail({
          email: balance.user.email,
          name: balance.user.fullName,
          remaining: balance.remaining,
          allocated: balance.allocated + balance.boostTokens,
          year,
          checkpoint: dueTier,
        });
        balance.lastReminderCheckpoint = dueTier;
        balance.lastReminderSentAt = new Date();
        await this.tokenBalanceRepository.save(balance);
        sent++;
      } catch (err) {
        this.logger.warn(
          `Token reminder failed for ${balance.user.email}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    this.logger.log(`Token usage reminder (${dueTier}) sent to ${sent} employee(s) for ${year}.`);
    return { sent };
  }
}
