import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TokenRequest } from '../entities/token-request.entity';
import { User } from '../entities/user.entity';
import {
  APPROVAL_ESCALATION_DAYS,
  APPROVAL_SLA_DAYS,
  EmailService,
} from '../common/services/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../entities/notification.entity';
import { DevelopmentOptionType, RequestStatus, UserRole } from '../common/enums';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Daily approver-SLA sweep over the two live approval stages.
 *
 * - PENDING requests older than APPROVAL_SLA_DAYS remind the assigned
 *   manager/coach; MANAGER_APPROVED requests aging from managerApprovedAt
 *   remind every active HR approver.
 * - Past APPROVAL_ESCALATION_DAYS the request is escalated once to active
 *   admins so a stalled approver can't silently block the pipeline.
 *
 * Each stage sends its reminder and its escalation at most once, tracked in
 * slaRemindedAt / slaEscalatedAt — both reset whenever the request enters a
 * new stage (manager approval, resubmission), so the HR stage gets a fresh
 * clock. Like TokenReminderService, the sweep is date-based catch-up, so a
 * missed day self-heals on the next run.
 */
@Injectable()
export class ApprovalSlaService {
  private readonly logger = new Logger(ApprovalSlaService.name);

  constructor(
    @InjectRepository(TokenRequest)
    private readonly requestRepo: Repository<TokenRequest>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly emailService: EmailService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @Cron('0 9 * * *', { timeZone: 'Asia/Manila' })
  async handleDailySweep(): Promise<void> {
    await this.runNow();
  }

  /** Safe to call repeatedly — already-sent reminders are skipped. */
  async runNow(): Promise<{ reminded: number; escalated: number }> {
    const now = Date.now();
    let reminded = 0;
    let escalated = 0;

    const inFlight = await this.requestRepo.find({
      where: [
        { status: RequestStatus.PENDING },
        { status: RequestStatus.MANAGER_APPROVED },
      ],
      relations: ['employee', 'manager', 'developmentOption'],
    });

    // Load escalation contacts / HR queue once for the whole sweep.
    const [admins, hrApprovers] = await Promise.all([
      this.activeUsersWithRole(UserRole.ADMIN),
      this.activeUsersWithRole(UserRole.HR_APPROVER),
    ]);

    for (const request of inFlight) {
      const stageStart =
        request.status === RequestStatus.PENDING
          ? request.createdAt
          : (request.managerApprovedAt ?? request.createdAt);
      const daysPending = Math.floor((now - new Date(stageStart).getTime()) / DAY_MS);

      try {
        if (daysPending >= APPROVAL_ESCALATION_DAYS && !request.slaEscalatedAt) {
          await this.notifyContacts(request, daysPending, admins, true);
          request.slaEscalatedAt = new Date();
          await this.requestRepo.save(request);
          escalated++;
        } else if (daysPending >= APPROVAL_SLA_DAYS && !request.slaRemindedAt) {
          const approvers =
            request.status === RequestStatus.PENDING
              ? request.manager
                ? [request.manager]
                : []
              : hrApprovers;
          await this.notifyContacts(request, daysPending, approvers, false);
          request.slaRemindedAt = new Date();
          await this.requestRepo.save(request);
          reminded++;
        }
      } catch (err) {
        this.logger.warn(
          `SLA notification failed for request ${request.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    this.logger.log(
      `Approval SLA sweep: ${reminded} reminder(s), ${escalated} escalation(s) across ${inFlight.length} in-flight request(s).`,
    );
    return { reminded, escalated };
  }

  private async activeUsersWithRole(role: UserRole): Promise<User[]> {
    return this.userRepo
      .createQueryBuilder('user')
      .where(':role = ANY(user.roles)', { role })
      .andWhere('user.isActive = true')
      .getMany();
  }

  private async notifyContacts(
    request: TokenRequest,
    daysPending: number,
    recipients: User[],
    escalation: boolean,
  ): Promise<void> {
    const employeeName = `${request.employee.firstName} ${request.employee.lastName}`;
    const optionName = request.developmentOption?.name ?? request.type;
    const stage: 'Manager' | 'Coach' | 'HR' =
      request.status === RequestStatus.MANAGER_APPROVED
        ? 'HR'
        : request.type === DevelopmentOptionType.COACHING
          ? 'Coach'
          : 'Manager';

    // Deduplicate — an admin may also be the assigned approver.
    const unique = new Map(recipients.map((r) => [r.id, r]));

    for (const recipient of unique.values()) {
      await this.emailService.sendApprovalSlaReminderEmail({
        recipientEmail: recipient.email,
        recipientName: `${recipient.firstName} ${recipient.lastName}`,
        employeeName,
        optionName,
        stage,
        daysPending,
        escalation,
      });

      this.notificationsService
        .create(recipient.id, {
          title: escalation ? 'Overdue Request Escalated' : 'Request Awaiting Your Review',
          message: escalation
            ? `${employeeName}'s ${optionName.replace(/_/g, ' ')} request has waited ${daysPending} days at the ${stage} stage. Please follow up.`
            : `${employeeName}'s ${optionName.replace(/_/g, ' ')} request has been in your queue for ${daysPending} days (SLA: ${APPROVAL_SLA_DAYS} days).`,
          type: NotificationType.WARNING,
          requestId: request.id,
          metadata: { deeplink: '/approval' },
        })
        .catch(() => {});
    }
  }
}
