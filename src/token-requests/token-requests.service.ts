import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  GoneException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { TokenRequest } from '../entities/token-request.entity';
import { User } from '../entities/user.entity';
import { DevelopmentOption } from '../entities/development-option.entity';
import { CoachingSession } from '../entities/coaching-session.entity';
import { TokenBalancesService } from '../token-balances/token-balances.service';
import {
  APPROVAL_UNDO_WINDOW_MS,
  EmailService,
} from '../common/services/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../entities/notification.entity';
import { RequestStatus, UserRole, DevelopmentOptionType } from '../common/enums';
import { CreateTaskOffloadingRequestDto } from './dto/create-task-offloading-request.dto';
import { CreateCoachingRequestDto } from './dto/create-coaching-request.dto';
import { CreateLearningSubsidyRequestDto } from './dto/create-learning-subsidy-request.dto';
import { RejectTokenRequestDto } from './dto/reject-token-request.dto';
import { ResubmitTokenRequestDto } from './dto/resubmit-token-request.dto';

/**
 * Bell-entry titles for the outcome of an approve/reject.
 *
 * Shared between the code that creates them and the undo path that deletes them —
 * inline strings on both sides would drift apart the first time someone reworded
 * one, and the undo would silently stop cleaning up.
 */
const DECISION_TITLES = {
  /** Employee: fully approved, tokens deducted. */
  APPROVED_FINAL: 'Request Approved! 🎉',
  /** Employee: first-level approved, now queued for HR. */
  APPROVED_BY_MANAGER: 'Request Approved by Manager',
  /** HR: a request has entered their queue. */
  PENDING_HR: 'Request Pending HR Approval',
  /** Employee: rejected at either level. */
  REJECTED: 'Request Not Approved',
} as const;

@Injectable()
export class TokenRequestsService {
  private readonly logger = new Logger(TokenRequestsService.name);

  constructor(
    @InjectRepository(TokenRequest)
    private readonly requestRepo: Repository<TokenRequest>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(DevelopmentOption)
    private readonly optionRepo: Repository<DevelopmentOption>,
    private readonly tokenBalancesService: TokenBalancesService,
    private readonly emailService: EmailService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private async findRequest(id: string): Promise<TokenRequest> {
    const request = await this.requestRepo.findOne({
      where: { id },
      relations: ['employee', 'manager', 'hr', 'rejectedBy', 'developmentOption'],
    });
    if (!request) throw new NotFoundException(`Token request ${id} not found`);
    return request;
  }

  /**
   * Record an approve/reject so it can be reversed within the undo window.
   * Mutates the request — the caller saves.
   *
   * `previousStatus` is the status the request held *before* this decision, which
   * is where an undo puts it back.
   */
  private stampDecision(
    request: TokenRequest,
    type: 'manager_approve' | 'hr_approve' | 'manager_reject' | 'hr_reject',
    actorId: string,
    previousStatus: RequestStatus,
  ): void {
    request.lastDecisionAt = new Date();
    request.lastDecisionById = actorId;
    request.lastDecisionType = type;
    request.previousStatus = previousStatus;
    request.lastDecisionUndoneAt = null;
  }

  /** Drop the undo record — the request has moved on by some other route. */
  private clearDecision(request: TokenRequest): void {
    request.lastDecisionAt = null;
    request.lastDecisionById = null;
    request.lastDecisionType = null;
    request.previousStatus = null;
    request.lastDecisionUndoneAt = null;
  }

  /**
   * Validate a task-offloading date range. The frontend enforces this too, but
   * the backend must be authoritative (direct API calls bypass the UI).
   */
  private assertValidDateRange(startDate: string, endDate: string): void {
    if (new Date(endDate) < new Date(startDate)) {
      throw new BadRequestException('End date cannot be before start date.');
    }
  }

  /**
   * The Task Offloading form allows a project duration of 1–3 months.
   * Enforce the upper bound here (the UI communicates the range); a shorter
   * project is left to the approvers' judgment rather than hard-blocked.
   */
  private assertProjectDurationWithinLimit(
    startDate: string,
    endDate: string,
  ): void {
    const limit = new Date(startDate);
    limit.setMonth(limit.getMonth() + 3);
    if (new Date(endDate) > limit) {
      throw new BadRequestException('Project duration cannot exceed 3 months.');
    }
  }

  /**
   * Tokens tied up in requests that are still in the approval pipeline.
   * Tokens are only deducted at final approval, so the raw balance overstates
   * what an employee can still spend — every balance check must subtract this.
   */
  private async getCommittedTokens(employeeId: string, year: number): Promise<number> {
    const row = await this.requestRepo
      .createQueryBuilder('r')
      .select('COALESCE(SUM(r."tokenCost"), 0)', 'committed')
      .where('r."employeeId" = :employeeId', { employeeId })
      .andWhere('r.year = :year', { year })
      .andWhere('r.status IN (:...statuses)', {
        statuses: [RequestStatus.PENDING, RequestStatus.MANAGER_APPROVED],
      })
      .getRawOne<{ committed: string }>();
    return Number(row?.committed ?? 0);
  }

  /** Balance check that counts in-flight requests against the remaining tokens. */
  private async assertSpendableBalance(
    employeeId: string,
    year: number,
    remaining: number,
    required: number,
  ): Promise<void> {
    const committed = await this.getCommittedTokens(employeeId, year);
    const spendable = remaining - committed;
    if (spendable < required) {
      throw new BadRequestException(
        committed > 0
          ? `Insufficient tokens. Required: ${required}, Available: ${remaining}, of which ${committed} already committed to requests awaiting approval.`
          : `Insufficient tokens. Required: ${required}, Available: ${remaining}`,
      );
    }
  }

  /**
   * Resolve the manager for an employee.
   * Uses immediateSupervisorId if that user has approver role,
   * otherwise falls back to any admin.
   */
  private async resolveManager(employee: User): Promise<User> {
    if (!employee.immediateSupervisorId) {
      throw new BadRequestException('No immediate supervisor assigned to this employee');
    }

    const supervisor = await this.userRepo.findOne({
      where: { id: employee.immediateSupervisorId },
    });

    if (!supervisor) {
      throw new BadRequestException('Assigned supervisor not found in the system');
    }

    if (!supervisor.roles.includes(UserRole.APPROVER)) {
      throw new BadRequestException(
        `Supervisor ${supervisor.firstName} ${supervisor.lastName} does not have the approver role`,
      );
    }

    return supervisor;
  }

  // ─── Submit ──────────────────────────────────────────────────────────────────

  /** Shared setup: validate employee, option, balance, resolve manager. */
  private async prepareRequest(
    employeeId: string,
    developmentOptionId: string,
    expectedType: DevelopmentOptionType,
  ) {
    const employee = await this.userRepo.findOne({ where: { id: employeeId } });
    if (!employee) throw new NotFoundException('Employee not found');

    const option = await this.optionRepo.findOne({ where: { id: developmentOptionId } });
    if (!option) throw new NotFoundException('Development option not found');
    if (!option.isActive) throw new BadRequestException('This development option is currently inactive');
    if (option.type !== expectedType) {
      throw new BadRequestException(
        `Expected a ${expectedType} option, got ${option.type}`,
      );
    }

    const year = new Date().getFullYear();
    const balance = await this.tokenBalancesService.getBalance(employeeId, year);
    const manager = await this.resolveManager(employee);

    return { employee, option, year, balance, manager };
  }

  /** Save the request, notify the manager, and return the full record. */
  private async saveAndNotify(opts: {
    employeeId: string;
    optionId: string;
    optionType: DevelopmentOptionType;
    tokenCost: number;
    year: number;
    managerId: string;
    employee: User;
    manager: User;
    formData: Record<string, unknown>;
    attachmentUrl?: string;
  }): Promise<TokenRequest> {
    const { employeeId, optionId, optionType, tokenCost, year, managerId, employee, manager, formData, attachmentUrl } = opts;

    const request = this.requestRepo.create({
      employeeId,
      developmentOptionId: optionId,
      type: optionType,
      tokenCost,
      year,
      status: RequestStatus.PENDING,
      managerId,
      snapshotDepartment: employee.department,
      snapshotPosition: employee.position,
      snapshotManagerName: `${manager.firstName} ${manager.lastName}`,
      formData,
      attachmentUrl,
    });

    await this.requestRepo.save(request);
    this.logger.log(`Token request created: ${request.id} by employee ${employeeId}`);

    // ── Notify employee: submission confirmation ──
    try {
      await this.emailService.sendSubmissionConfirmation({
        employeeEmail: employee.email,
        employeeName: `${employee.firstName} ${employee.lastName}`,
        optionName: optionType,
        tokenCost,
        submissionDate: new Date(),
      });
    } catch (err: unknown) {
      this.logger.warn(`Failed to send submission confirmation: ${(err as Error).message}`);
    }

    // ── In-app: submission confirmation to employee ──
    this.notificationsService.create(employeeId, {
      title: 'Request Submitted',
      message: `Your ${optionType.replace(/_/g, ' ')} request has been submitted and is awaiting approval.`,
      type: NotificationType.INFO,
      requestId: request.id,
      metadata: { deeplink: '/my-request' },
    }).catch(() => {});

    // ── In-app: notify manager/coach ──
    this.notificationsService.create(managerId, {
      title: 'New Request Pending Your Approval',
      message: `${employee.firstName} ${employee.lastName} submitted a ${optionType.replace(/_/g, ' ')} request.`,
      type: NotificationType.INFO,
      requestId: request.id,
      metadata: { deeplink: '/approval' },
    }).catch(() => {});

    // ── Notify manager/coach: review required ──
    try {
      await this.emailService.sendFirstLevelReviewNotification({
        approverEmail: manager.email,
        approverName: `${manager.firstName} ${manager.lastName}`,
        approverRole: optionType === DevelopmentOptionType.COACHING ? 'Coach' : 'Manager',
        employeeName: `${employee.firstName} ${employee.lastName}`,
        optionName: optionType,
        tokenCost,
        submissionDate: new Date(),
        requestId: request.id,
      });
    } catch (err: unknown) {
      this.logger.warn(`Failed to send first-level reviewer notification: ${(err as Error).message}`);
    }

    return this.findRequest(request.id);
  }

  /**
   * POST /token-requests/task-offloading
   * Costs 1 token. Cannot repeat in consecutive years.
   */
  async createTaskOffloading(
    employeeId: string,
    dto: CreateTaskOffloadingRequestDto,
  ): Promise<TokenRequest> {
    this.assertValidDateRange(dto.formData.startDate, dto.formData.endDate);
    this.assertProjectDurationWithinLimit(
      dto.formData.startDate,
      dto.formData.endDate,
    );

    const { employee, option, year, balance, manager } = await this.prepareRequest(
      employeeId,
      dto.developmentOptionId,
      DevelopmentOptionType.TASK_OFFLOADING,
    );

    // Consecutive-year guard
    const previousYear = year - 1;
    const existingApproval = await this.requestRepo.findOne({
      where: {
        employeeId,
        type: DevelopmentOptionType.TASK_OFFLOADING,
        status: RequestStatus.APPROVED,
        year: previousYear,
      },
    });
    if (existingApproval) {
      throw new BadRequestException(
        'Task Offloading cannot be requested in consecutive years. You were approved last year.',
      );
    }

    // One OTJ/special project per year — includes requests still in the pipeline.
    const existingThisYear = await this.requestRepo.findOne({
      where: {
        employeeId,
        type: DevelopmentOptionType.TASK_OFFLOADING,
        status: In([RequestStatus.PENDING, RequestStatus.MANAGER_APPROVED, RequestStatus.APPROVED]),
        year,
      },
    });
    if (existingThisYear) {
      throw new BadRequestException(
        existingThisYear.status === RequestStatus.APPROVED
          ? 'Task Offloading is limited to one project per year — you already have an approved request this year.'
          : 'You already have a Task Offloading request awaiting approval this year.',
      );
    }

    await this.assertSpendableBalance(employeeId, year, balance.remaining, option.tokenCost);

    return this.saveAndNotify({
      employeeId,
      optionId: option.id,
      optionType: option.type,
      tokenCost: option.tokenCost,
      year,
      managerId: manager.id,
      employee,
      manager,
      formData: { ...dto.formData },
      attachmentUrl: dto.attachmentUrl,
    });
  }

  /**
   * POST /token-requests/coaching
   * Costs 2 tokens.
   * Approval flow: Employee → Coach (first-level) → HR (final) → tokens deducted.
   * The coach is stored as managerId so the standard approve/reject routing works.
   */
  async createCoaching(
    employeeId: string,
    dto: CreateCoachingRequestDto,
  ): Promise<TokenRequest> {
    // Manually prepare — coaching does not require the supervisor to have approver role.
    const employee = await this.userRepo.findOne({ where: { id: employeeId } });
    if (!employee) throw new NotFoundException('Employee not found');

    const option = await this.optionRepo.findOne({ where: { id: dto.developmentOptionId } });
    if (!option) throw new NotFoundException('Development option not found');
    if (!option.isActive) throw new BadRequestException('This development option is currently inactive');
    if (option.type !== DevelopmentOptionType.COACHING) {
      throw new BadRequestException(`Expected a coaching option, got ${option.type}`);
    }

    const year = new Date().getFullYear();
    const balance = await this.tokenBalancesService.getBalance(employeeId, year);

    // Validate coach
    const coach = await this.userRepo.findOne({ where: { id: dto.coachId } });
    if (!coach) throw new NotFoundException('Coach not found');
    if (!coach.roles.includes(UserRole.COACH)) {
      throw new BadRequestException('The selected employee does not have the coach role');
    }
    if (coach.id === employeeId) {
      throw new BadRequestException('You cannot nominate yourself as your coach');
    }

    // One coaching cycle in the pipeline at a time.
    const inFlightCoaching = await this.requestRepo.findOne({
      where: {
        employeeId,
        type: DevelopmentOptionType.COACHING,
        status: In([RequestStatus.PENDING, RequestStatus.MANAGER_APPROVED]),
      },
    });
    if (inFlightCoaching) {
      throw new BadRequestException(
        'You already have a coaching request awaiting approval. Wait for it to be decided (or cancel it) before submitting another.',
      );
    }

    await this.assertSpendableBalance(employeeId, year, balance.remaining, option.tokenCost);

    // Use coach as the first-level approver (managerId = coach.id).
    // snapshotManagerName captures the coach's name as the first approver.
    return this.saveAndNotify({
      employeeId,
      optionId: option.id,
      optionType: option.type,
      tokenCost: option.tokenCost,
      year,
      managerId: coach.id,   // ← coach, not supervisor
      employee,
      manager: coach,         // ← notifies coach by email
      formData: {
        coachId: dto.coachId,
        coachName: `${coach.firstName} ${coach.lastName}`,
        notes: dto.notes ?? null,
        focusArea: dto.formData.focusArea,
        developmentObjective: dto.formData.developmentObjective,
        keyChallenges: dto.formData.keyChallenges ?? null,
        expectedOutcomes: dto.formData.expectedOutcomes ?? null,
        preferredSchedule: dto.formData.preferredSchedule,
        sameCoachAcknowledged: dto.formData.sameCoachAcknowledged,
      },
      attachmentUrl: dto.attachmentUrl,
    });
  }

  /**
   * POST /token-requests/learning-subsidy
   * subsidyAmount determines tokenCost (1 token = ₱1,000, max ₱3,000 / 3 tokens).
   */
  async createLearningSubsidy(
    employeeId: string,
    dto: CreateLearningSubsidyRequestDto,
  ): Promise<TokenRequest> {
    this.assertValidDateRange(dto.formData.startDate, dto.formData.endDate);

    // The form asks for the actual value: the request can't exceed the cost.
    if (dto.subsidyAmount > dto.formData.totalCost) {
      throw new BadRequestException(
        `Subsidy amount ₱${dto.subsidyAmount.toLocaleString()} cannot exceed the total training cost of ₱${dto.formData.totalCost.toLocaleString()}`,
      );
    }

    const { employee, option, year, balance, manager } = await this.prepareRequest(
      employeeId,
      dto.developmentOptionId,
      DevelopmentOptionType.LEARNING_SUBSIDY,
    );

    // Derive token cost from subsidy amount
    const subsidyPerToken: number =
      (option.rules as Record<string, number>)?.subsidyPerToken ?? 1000;
    const tokenCost = Math.ceil(dto.subsidyAmount / subsidyPerToken);
    const maxTokens: number = (option.rules as Record<string, number>)?.maxTokens ?? 3;

    if (tokenCost > maxTokens) {
      throw new BadRequestException(
        `Subsidy amount ₱${dto.subsidyAmount} exceeds the maximum of ₱${maxTokens * subsidyPerToken}`,
      );
    }
    await this.assertSpendableBalance(employeeId, year, balance.remaining, tokenCost);

    return this.saveAndNotify({
      employeeId,
      optionId: option.id,
      optionType: option.type,
      tokenCost, // overrides option.tokenCost — varies per amount
      year,
      managerId: manager.id,
      employee,
      manager,
      formData: {
        courseName: dto.courseName,
        provider: dto.provider,
        subsidyAmount: dto.subsidyAmount,
        tokenCost,
        startDate: dto.formData.startDate,
        endDate: dto.formData.endDate,
        modeOfTraining: dto.formData.modeOfTraining,
        totalCost: dto.formData.totalCost,
        learningDescription: dto.formData.learningDescription,
        businessAlignment: dto.formData.businessAlignment,
        applicationPlan: dto.formData.applicationPlan,
        duringWorkHours: dto.formData.duringWorkHours,
        onePerTeamAcknowledged: dto.formData.onePerTeamAcknowledged,
        reimbursementType: dto.formData.reimbursementType,
      },
      attachmentUrl: dto.attachmentUrl,
    });
  }

  // ─── Manager Approve ──────────────────────────────────────────────────────────

  async managerApprove(requestId: string, approverId: string): Promise<TokenRequest> {
    const request = await this.findRequest(requestId);

    if (request.status !== RequestStatus.PENDING) {
      throw new BadRequestException(`Request is not pending (current: ${request.status})`);
    }
    if (request.managerId !== approverId) {
      throw new ForbiddenException('You are not the assigned manager for this request');
    }

    request.managerApprovedAt = new Date();
    this.stampDecision(
      request,
      'manager_approve',
      approverId,
      RequestStatus.PENDING,
    );

    // Options configured without HR review finalize at first-level approval.
    // The flag is read live (not snapshotted) so a policy change applies to
    // requests already in flight.
    if (request.developmentOption && !request.developmentOption.requiresHrApproval) {
      request.status = RequestStatus.APPROVED;
      // Fresh stage ⇒ fresh SLA clock (no next stage here, but keep rows clean).
      request.slaRemindedAt = null;
      request.slaEscalatedAt = null;
      await this.requestRepo.save(request);
      this.logger.log(
        `Request ${requestId} approved at first level by ${approverId} (option does not require HR approval)`,
      );
      await this.finalizeApproval(request);
      return this.findRequest(requestId);
    }

    request.status = RequestStatus.MANAGER_APPROVED;
    // The request enters a new queue — restart SLA tracking for the HR stage.
    request.slaRemindedAt = null;
    request.slaEscalatedAt = null;
    await this.requestRepo.save(request);
    this.logger.log(`Request ${requestId} manager-approved by ${approverId}`);

    // ── Resolve HR and notify ──
    const hrUsers = await this.userRepo
      .createQueryBuilder('user')
      .where(':role = ANY(user.roles)', { role: UserRole.HR_APPROVER })
      .andWhere('user.isActive = true')
      .getMany();

    const firstApprover = await this.userRepo.findOne({ where: { id: request.managerId } });

    for (const hrUser of hrUsers) {
      try {
        await this.emailService.sendHrReviewNotification({
          hrEmail: hrUser.email,
          hrName: `${hrUser.firstName} ${hrUser.lastName}`,
          employeeName: `${request.employee.firstName} ${request.employee.lastName}`,
          optionName: request.developmentOption?.name ?? request.type,
          tokenCost: request.tokenCost,
          firstApproverName: firstApprover
            ? `${firstApprover.firstName} ${firstApprover.lastName}`
            : request.snapshotManagerName,
          firstApproverRole: request.type === DevelopmentOptionType.COACHING ? 'Coach' : 'Manager',
          requestId: request.id,
        });
      } catch (err: unknown) {
        this.logger.warn(`Failed to send HR notification: ${(err as Error).message}`);
      }

      // ── In-app: notify HR ──
      this.notificationsService.create(hrUser.id, {
        title: DECISION_TITLES.PENDING_HR,
        message: `${request.employee.firstName} ${request.employee.lastName}'s ${(request.developmentOption?.name ?? request.type).replace(/_/g, ' ')} request has been approved by the ${request.type === DevelopmentOptionType.COACHING ? 'coach' : 'manager'} and needs your review.`,
        type: NotificationType.INFO,
        requestId: request.id,
        metadata: { deeplink: '/approval' },
      }).catch(() => {});
    }

    // ── In-app: notify employee that manager approved ──
    this.notificationsService.create(request.employeeId, {
      title: DECISION_TITLES.APPROVED_BY_MANAGER,
      message: `Your ${(request.developmentOption?.name ?? request.type).replace(/_/g, ' ')} request has been approved by your ${request.type === DevelopmentOptionType.COACHING ? 'coach' : 'manager'} and is now pending HR review.`,
      type: NotificationType.INFO,
      requestId: request.id,
      metadata: { deeplink: '/my-request' },
    }).catch(() => {});

    return this.findRequest(requestId);
  }

  // ─── HR Approve ───────────────────────────────────────────────────────────────

  async hrApprove(requestId: string, hrUserId: string): Promise<TokenRequest> {
    const request = await this.findRequest(requestId);

    if (request.status !== RequestStatus.MANAGER_APPROVED) {
      throw new BadRequestException(
        `Request must be manager-approved first (current: ${request.status})`,
      );
    }

    request.status = RequestStatus.APPROVED;
    request.hrId = hrUserId;
    request.hrApprovedAt = new Date();
    this.stampDecision(
      request,
      'hr_approve',
      hrUserId,
      RequestStatus.MANAGER_APPROVED,
    );
    await this.requestRepo.save(request);
    this.logger.log(`Request ${requestId} HR-approved by ${hrUserId}`);

    await this.finalizeApproval(request);

    return this.findRequest(requestId);
  }

  /**
   * Shared tail of a final approval — whichever level finalized it (HR, or the
   * manager/coach when the option skips HR review): deduct tokens and tell the
   * employee. The request must already be saved with status APPROVED.
   */
  private async finalizeApproval(request: TokenRequest): Promise<void> {
    await this.tokenBalancesService.deductTokens(request.employeeId, request.year, request.tokenCost);

    try {
      await this.emailService.sendApprovalNotification({
        employeeEmail: request.employee.email,
        employeeName: `${request.employee.firstName} ${request.employee.lastName}`,
        optionName: request.developmentOption?.name ?? request.type,
        tokenCost: request.tokenCost,
        requestId: request.id,
        type: request.type,
      });
    } catch (err: unknown) {
      this.logger.warn(`Failed to send approval email: ${(err as Error).message}`);
    }

    this.notificationsService.create(request.employeeId, {
      title: DECISION_TITLES.APPROVED_FINAL,
      message: `Your ${(request.developmentOption?.name ?? request.type).replace(/_/g, ' ')} request has been fully approved. ${request.tokenCost} token${request.tokenCost !== 1 ? 's' : ''} have been deducted.`,
      type: NotificationType.SUCCESS,
      requestId: request.id,
      metadata: {
        deeplink: request.type === DevelopmentOptionType.COACHING
          ? `/coaching/${request.id}/sessions`
          : '/my-request',
      },
    }).catch(() => {});
  }

  /**
   * Finalize requests left waiting on HR for an option that no longer requires
   * it. Manager approval is the last step for such an option, so a request
   * sitting in MANAGER_APPROVED after the policy flips has nothing left to wait
   * for — it would otherwise sit in the HR queue forever, under an option the
   * rules say HR shouldn't be reviewing.
   *
   * `managerApprove` already reads `requiresHrApproval` live so a policy change
   * applies to in-flight requests; this extends that to the ones that were
   * already past the manager's decision when the policy changed.
   *
   * Each request is finalized independently: one that can't be (e.g. the
   * employee no longer has the balance) is logged and left alone rather than
   * blocking the rest. Returns how many were finalized.
   */
  async finalizeRequestsNoLongerAwaitingHr(
    developmentOptionId: string,
  ): Promise<{ finalized: number; skipped: number }> {
    const stranded = await this.requestRepo.find({
      where: {
        developmentOptionId,
        status: RequestStatus.MANAGER_APPROVED,
      },
      relations: ['employee', 'developmentOption'],
    });

    let finalized = 0;
    let skipped = 0;

    for (const request of stranded) {
      try {
        // The deduction and the status change share a transaction, so this can
        // never leave a request approved with its tokens untaken.
        await this.requestRepo.manager.transaction(async (manager) => {
          await this.tokenBalancesService.deductTokens(
            request.employeeId,
            request.year,
            request.tokenCost,
            manager,
          );
          request.status = RequestStatus.APPROVED;
          request.slaRemindedAt = null;
          request.slaEscalatedAt = null;
          await manager.getRepository(TokenRequest).save(request);
        });

        this.logger.log(
          `Request ${request.id} finalized — ${request.developmentOption?.name ?? request.type} no longer requires HR approval`,
        );
        finalized++;

        // Notify only after the transaction commits, matching finalizeApproval.
        try {
          await this.emailService.sendApprovalNotification({
            employeeEmail: request.employee.email,
            employeeName: `${request.employee.firstName} ${request.employee.lastName}`,
            optionName: request.developmentOption?.name ?? request.type,
            tokenCost: request.tokenCost,
            requestId: request.id,
            type: request.type,
          });
        } catch (err: unknown) {
          this.logger.warn(
            `Failed to send approval email: ${(err as Error).message}`,
          );
        }

        this.notificationsService
          .create(request.employeeId, {
            title: DECISION_TITLES.APPROVED_FINAL,
            message: `Your ${(request.developmentOption?.name ?? request.type).replace(/_/g, ' ')} request has been fully approved. ${request.tokenCost} token${request.tokenCost !== 1 ? 's' : ''} have been deducted.`,
            type: NotificationType.SUCCESS,
            requestId: request.id,
            metadata: {
              deeplink:
                request.type === DevelopmentOptionType.COACHING
                  ? `/coaching/${request.id}/sessions`
                  : '/my-request',
            },
          })
          .catch(() => {});
      } catch (err: unknown) {
        skipped++;
        this.logger.warn(
          `Could not finalize request ${request.id} after HR requirement was removed: ${(err as Error).message}`,
        );
      }
    }

    return { finalized, skipped };
  }

  // ─── Reject ───────────────────────────────────────────────────────────────────

  async reject(
    requestId: string,
    rejectorId: string,
    dto: RejectTokenRequestDto,
    level: 'manager' | 'hr',
  ): Promise<TokenRequest> {
    const request = await this.findRequest(requestId);

    const allowedStatuses =
      level === 'manager'
        ? [RequestStatus.PENDING]
        : [RequestStatus.PENDING, RequestStatus.MANAGER_APPROVED];

    if (!allowedStatuses.includes(request.status)) {
      throw new BadRequestException(
        `Cannot reject a request with status: ${request.status}`,
      );
    }

    if (level === 'manager' && request.managerId !== rejectorId) {
      throw new ForbiddenException('You are not the assigned manager for this request');
    }

    // Captured before the overwrite — an HR rejection can arrive from either
    // `pending` or `manager_approved`, so this is the only record of where an
    // undo should put the request back.
    const statusBeforeRejection = request.status;

    request.status = RequestStatus.REJECTED;
    request.rejectedById = rejectorId;
    request.rejectedByLevel = level;
    request.rejectionComment = dto.comment;
    request.rejectedAt = new Date();
    this.stampDecision(
      request,
      level === 'manager' ? 'manager_reject' : 'hr_reject',
      rejectorId,
      statusBeforeRejection,
    );
    await this.requestRepo.save(request);
    this.logger.log(`Request ${requestId} rejected by ${rejectorId} (${level})`);

    // ── Notify employee ──
    try {
      await this.emailService.sendRejectionNotification({
        employeeEmail: request.employee.email,
        employeeName: `${request.employee.firstName} ${request.employee.lastName}`,
        optionName: request.developmentOption?.name ?? request.type,
        comment: dto.comment,
      });
    } catch (err: unknown) {
      this.logger.warn(`Failed to send rejection email: ${(err as Error).message}`);
    }

    // ── In-app: notify employee rejection ──
    this.notificationsService.create(request.employeeId, {
      title: DECISION_TITLES.REJECTED,
      message: `Your ${(request.developmentOption?.name ?? request.type).replace(/_/g, ' ')} request was not approved. Reason: ${dto.comment}`,
      type: NotificationType.ERROR,
      requestId: request.id,
      metadata: { deeplink: '/my-request' },
    }).catch(() => {});

    return this.findRequest(requestId);
  }

  // ─── Undo a decision ──────────────────────────────────────────────────────────

  /**
   * The status each decision type produces. An undo is only valid while the
   * request is still sitting in that status — if it has moved on, something
   * downstream has already acted on the decision and reversing it would corrupt
   * that work.
   */
  private static readonly DECISION_RESULT_STATUS: Record<
    string,
    RequestStatus[]
  > = {
    // A manager approval lands on MANAGER_APPROVED, or APPROVED when the option
    // skips HR review.
    manager_approve: [RequestStatus.MANAGER_APPROVED, RequestStatus.APPROVED],
    hr_approve: [RequestStatus.APPROVED],
    manager_reject: [RequestStatus.REJECTED],
    hr_reject: [RequestStatus.REJECTED],
  };

  /**
   * PATCH /token-requests/:id/undo-decision
   * Reverse the approve/reject recorded on this request, restoring the status it
   * held beforehand and refunding any tokens the decision deducted.
   *
   * Only the approver who made the decision — or an admin — may undo it, and only
   * within APPROVAL_UNDO_WINDOW_MS. The window is a ceiling, not a guarantee: an
   * undo also dies the moment anything downstream acts on the decision (HR
   * approves, the employee resubmits or cancels, a coaching session is booked).
   *
   * The status flip and the token refund share one transaction, so a request can
   * never end up reverted with its tokens still spent.
   */
  async undoDecision(requestId: string, actor: User): Promise<TokenRequest> {
    const isAdmin = actor.roles.includes(UserRole.ADMIN);

    // Captured for the post-commit notifications.
    let refunded = 0;
    let restoredStatus: RequestStatus;
    let decisionType: string;

    await this.requestRepo.manager.transaction(async (manager) => {
      // Lock the row first: without this, two undos (or an undo racing an HR
      // approval) could both pass the guards below on stale reads.
      //
      // No `relations` here on purpose — TypeORM emits relations as LEFT JOINs,
      // and Postgres rejects FOR UPDATE against the nullable side of an outer
      // join. Nothing below needs them; the notification step re-reads the
      // request with its relations after the transaction commits.
      const request = await manager.findOne(TokenRequest, {
        where: { id: requestId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!request)
        throw new NotFoundException(`Token request ${requestId} not found`);

      // ── Guard 1: a decision exists and is still inside the window ──
      if (!request.lastDecisionAt || !request.lastDecisionType) {
        throw new BadRequestException('This request has no decision to undo');
      }
      // Elapsed time is computed here rather than in SQL on purpose: the app and
      // the database can disagree about the current time, and the decision
      // timestamp was written by the app.
      const elapsed = Date.now() - new Date(request.lastDecisionAt).getTime();
      if (elapsed > APPROVAL_UNDO_WINDOW_MS) {
        throw new GoneException(
          'The time window for undoing this decision has passed',
        );
      }

      // ── Guard 2: not already undone ──
      if (request.lastDecisionUndoneAt) {
        throw new ConflictException('This decision has already been undone');
      }

      // ── Guard 3: nothing downstream has moved the request on ──
      const expected =
        TokenRequestsService.DECISION_RESULT_STATUS[request.lastDecisionType] ??
        [];
      if (!expected.includes(request.status)) {
        throw new ConflictException(
          `This decision can no longer be undone — the request has since moved to "${request.status}"`,
        );
      }

      // ── Guard 4: only the decider, or an admin ──
      if (!isAdmin && request.lastDecisionById !== actor.id) {
        throw new ForbiddenException(
          'Only the approver who made this decision can undo it',
        );
      }

      // ── Guard 5: no coaching sessions booked against the approval ──
      // Reverting an approved coaching request out from under a booked session
      // would leave the session pointing at a request that isn't approved.
      if (
        request.status === RequestStatus.APPROVED &&
        request.type === DevelopmentOptionType.COACHING
      ) {
        const sessions = await manager.count(CoachingSession, {
          where: { tokenRequestId: request.id },
        });
        if (sessions > 0) {
          throw new ConflictException(
            'This approval can no longer be undone — coaching sessions have already been booked',
          );
        }
      }

      if (!request.previousStatus) {
        // Only reachable for rows stamped before this column existed.
        throw new BadRequestException(
          'This decision predates undo support and cannot be reversed',
        );
      }

      decisionType = request.lastDecisionType;

      // ── Refund, if this decision was the one that spent the tokens ──
      // Rejections never deduct, and a manager approval that only queued the
      // request for HR hasn't deducted yet either.
      if (request.status === RequestStatus.APPROVED) {
        await this.tokenBalancesService.refundTokens(
          request.employeeId,
          request.year,
          request.tokenCost,
          manager,
        );
        refunded = request.tokenCost;
      }

      // ── Reverse the decision's own field writes ──
      switch (decisionType) {
        case 'manager_approve':
          request.managerApprovedAt = null as any;
          break;
        case 'hr_approve':
          request.hrId = null as any;
          request.hrApprovedAt = null as any;
          break;
        case 'manager_reject':
        case 'hr_reject':
          request.rejectedById = null as any;
          request.rejectedByLevel = null as any;
          request.rejectionComment = null as any;
          request.rejectedAt = null as any;
          break;
      }

      request.status = request.previousStatus;
      restoredStatus = request.status;

      // The request is live again at an earlier stage — restart that stage's SLA
      // clock so it isn't instantly treated as overdue or already escalated.
      request.slaRemindedAt = null;
      request.slaEscalatedAt = null;

      // Keep the decision record but mark it spent, so the same decision can't be
      // undone twice while the history of who did what stays readable.
      request.lastDecisionUndoneAt = new Date();

      await manager.save(TokenRequest, request);
    });

    this.logger.log(
      `Request ${requestId} decision (${decisionType!}) undone by ${actor.id}` +
        `${refunded > 0 ? `, refunded ${refunded} token(s)` : ''}` +
        ` → ${restoredStatus!}`,
    );

    const request = await this.findRequest(requestId);
    await this.notifyDecisionReversed(request, actor, {
      decisionType: decisionType!,
      refunded,
    });

    return request;
  }

  /**
   * Tell everyone who was told about the original decision that it no longer
   * stands, and clear the now-wrong bell entries that decision produced.
   *
   * Best-effort throughout: the reversal is already committed, so a failed email
   * must never surface as a failed undo.
   */
  private async notifyDecisionReversed(
    request: TokenRequest,
    actor: User,
    opts: { decisionType: string; refunded: number },
  ): Promise<void> {
    const { decisionType, refunded } = opts;
    const optionName = request.developmentOption?.name ?? request.type;
    const optionLabel = optionName.replace(/_/g, ' ');
    const wasApproval = decisionType.endsWith('_approve');

    // HR only needs telling if the request was in (or has returned to) their queue.
    const hrWasInvolved =
      decisionType === 'manager_approve' || decisionType === 'hr_reject';
    const hrUsers = hrWasInvolved
      ? await this.userRepo
          .createQueryBuilder('user')
          .where(':role = ANY(user.roles)', { role: UserRole.HR_APPROVER })
          .andWhere('user.isActive = true')
          .getMany()
      : [];

    // ── Drop the stale bell entries the reversed decision created ──
    // Targeted at the specific outcome titles rather than everything on the
    // request, so the submission/earlier history survives.
    try {
      await this.notificationsService.deleteForRequestByTitles(
        request.id,
        [request.employeeId],
        wasApproval
          ? [
              DECISION_TITLES.APPROVED_FINAL,
              DECISION_TITLES.APPROVED_BY_MANAGER,
            ]
          : [DECISION_TITLES.REJECTED],
      );
      // A manager approval that queued the request for HR also put an entry in
      // every HR approver's bell; undoing it takes the request back out.
      if (decisionType === 'manager_approve' && hrUsers.length > 0) {
        await this.notificationsService.deleteForRequestByTitles(
          request.id,
          hrUsers.map((u) => u.id),
          [DECISION_TITLES.PENDING_HR],
        );
      }
    } catch (err: unknown) {
      this.logger.warn(
        `Failed to clear stale notifications for ${request.id}: ${(err as Error).message}`,
      );
    }

    const actorRole = this.describeActorRole(request, actor, decisionType);
    const stageLabel =
      request.status === RequestStatus.MANAGER_APPROVED
        ? 'Awaiting HR review'
        : 'Awaiting review';

    // ── Employee: email + bell ──
    try {
      await this.emailService.sendDecisionReversedNotification({
        employeeEmail: request.employee.email,
        employeeName: `${request.employee.firstName} ${request.employee.lastName}`,
        optionName,
        reversed: wasApproval ? 'approval' : 'rejection',
        stageLabel,
        tokensRefunded: refunded,
        actorRole,
      });
    } catch (err: unknown) {
      this.logger.warn(
        `Failed to send decision-reversed email: ${(err as Error).message}`,
      );
    }

    this.notificationsService
      .create(request.employeeId, {
        title: wasApproval ? 'Approval Withdrawn' : 'Rejection Withdrawn',
        message: wasApproval
          ? `The approval of your ${optionLabel} request was withdrawn by your ${actorRole} and it is back under review.${refunded > 0 ? ` ${refunded} token${refunded !== 1 ? 's' : ''} returned to your balance.` : ''}`
          : `Your ${optionLabel} request was not rejected after all — your ${actorRole} withdrew that decision and it is back under review.`,
        type: NotificationType.WARNING,
        requestId: request.id,
        metadata: { deeplink: '/my-request' },
      })
      .catch(() => {});

    // ── HR: the request has left, or re-entered, their queue ──
    for (const hrUser of hrUsers) {
      const returned = request.status === RequestStatus.MANAGER_APPROVED;
      this.notificationsService
        .create(hrUser.id, {
          title: returned
            ? 'Request Back in Your Queue'
            : 'Request Withdrawn from Your Queue',
          message: returned
            ? `${request.employee.firstName} ${request.employee.lastName}'s ${optionLabel} request is awaiting your review again — the earlier decision was undone.`
            : `${request.employee.firstName} ${request.employee.lastName}'s ${optionLabel} request no longer needs your review — the ${actorRole} undid their approval.`,
          type: NotificationType.INFO,
          requestId: request.id,
          metadata: { deeplink: '/approval' },
        })
        .catch(() => {});
    }
  }

  /** How the employee should hear the reverser described. */
  private describeActorRole(
    request: TokenRequest,
    actor: User,
    decisionType: string,
  ): 'manager' | 'coach' | 'HR' | 'administrator' {
    if (decisionType.startsWith('hr_')) return 'HR';
    if (request.type === DevelopmentOptionType.COACHING) return 'coach';
    // An admin acting on someone else's decision shouldn't be reported as the
    // employee's manager.
    if (
      actor.id !== request.managerId &&
      actor.roles.includes(UserRole.ADMIN)
    ) {
      return 'administrator';
    }
    return 'manager';
  }

  // ─── Cancel ───────────────────────────────────────────────────────────────────

  /**
   * PATCH /token-requests/:id/cancel
   * Employee withdraws their own request. Allowed while the request is still
   * `pending` and also once it is `manager_approved` — up to that point no
   * tokens have been deducted, so cancelling is a pure state change.
   *
   * A `manager_approved` request is already in someone's queue, so the approvers
   * are notified *before* the status flips: the manager who approved it, and
   * every active HR approver who would otherwise be reviewing it. A `pending`
   * request has only reached the manager, so only the manager is told.
   *
   * Once the request is fully `approved` the tokens are gone and cancelling
   * would need a refund path — still blocked here.
   */
  async cancel(requestId: string, employeeId: string): Promise<TokenRequest> {
    const request = await this.findRequest(requestId);

    if (request.employeeId !== employeeId) {
      throw new ForbiddenException('You can only cancel your own requests');
    }

    const cancellableStatuses = [
      RequestStatus.PENDING,
      RequestStatus.MANAGER_APPROVED,
    ];
    if (!cancellableStatuses.includes(request.status)) {
      throw new BadRequestException(
        `Only pending or manager-approved requests can be cancelled (current: ${request.status})`,
      );
    }

    const wasManagerApproved =
      request.status === RequestStatus.MANAGER_APPROVED;

    // ── Notify the approvers first, before the request leaves their queue ──
    await this.notifyApproversOfCancellation(request, wasManagerApproved);

    request.status = RequestStatus.CANCELLED;
    request.cancelledAt = new Date();
    // Withdrawn by the employee — any pending approver undo is moot.
    this.clearDecision(request);
    await this.requestRepo.save(request);
    this.logger.log(
      `Request ${requestId} cancelled by employee ${employeeId} (was: ${wasManagerApproved ? 'manager_approved' : 'pending'})`,
    );

    return this.findRequest(requestId);
  }

  /**
   * Tells the manager — and, once HR has it queued, every active HR approver —
   * that an employee withdrew a request they were reviewing.
   * Best-effort: a failed email or notification never blocks the cancellation.
   */
  private async notifyApproversOfCancellation(
    request: TokenRequest,
    wasManagerApproved: boolean,
  ): Promise<void> {
    const employeeName = `${request.employee.firstName} ${request.employee.lastName}`;
    const optionName = request.developmentOption?.name ?? request.type;
    const optionLabel = optionName.replace(/_/g, ' ');
    // Coaching requests are first-level approved by the coach, not the manager.
    const approverRole =
      request.type === DevelopmentOptionType.COACHING ? 'coach' : 'manager';

    const recipients: User[] = [];

    // findRequest() eager-loads the manager relation.
    if (request.manager) recipients.push(request.manager);

    // Once manager-approved the request sits in HR's queue too, so HR needs to
    // know it's gone.
    if (wasManagerApproved) {
      const hrUsers = await this.userRepo
        .createQueryBuilder('user')
        .where(':role = ANY(user.roles)', { role: UserRole.HR_APPROVER })
        .andWhere('user.isActive = true')
        .getMany();
      recipients.push(...hrUsers);
    }

    // The manager may also hold the HR role — don't notify them twice.
    const unique = new Map(recipients.map((r) => [r.id, r]));

    for (const recipient of unique.values()) {
      try {
        await this.emailService.sendRequestCancelledNotification({
          approverEmail: recipient.email,
          approverName: `${recipient.firstName} ${recipient.lastName}`,
          employeeName,
          optionName,
          tokenCost: request.tokenCost,
          wasManagerApproved,
          approverRole,
        });
      } catch (err: unknown) {
        this.logger.warn(
          `Failed to send cancellation email to ${recipient.email}: ${(err as Error).message}`,
        );
      }

      this.notificationsService
        .create(recipient.id, {
          title: 'Request Cancelled',
          message: `${employeeName} cancelled their ${optionLabel} request${wasManagerApproved ? ` after ${approverRole} approval` : ''}. No action is needed.`,
          type: NotificationType.WARNING,
          requestId: request.id,
          metadata: { deeplink: '/approval' },
        })
        .catch(() => {});
    }
  }
  // ─── Resubmit ─────────────────────────────────────────────────────────────────────────

  /**
   * PATCH /token-requests/:id/resubmit
   * Employee: update and resubmit a rejected request back to pending.
   * Only the original employee can call this. Only rejected requests qualify.
   */
  async resubmit(
    requestId: string,
    employeeId: string,
    dto: ResubmitTokenRequestDto,
  ): Promise<TokenRequest> {
    const request = await this.findRequest(requestId);

    if (request.employeeId !== employeeId) {
      throw new ForbiddenException('You can only resubmit your own requests');
    }
    if (request.status !== RequestStatus.REJECTED) {
      throw new BadRequestException(
        `Only rejected requests can be resubmitted (current: ${request.status})`,
      );
    }

    // Copy every defined DTO key from `keys` into `formData` — the resubmit
    // merge is "only what was sent changes".
    const mergeKeys = (
      formData: Record<string, unknown>,
      keys: (keyof ResubmitTokenRequestDto)[],
    ) => {
      for (const key of keys) {
        if (dto[key] !== undefined) formData[key] = dto[key];
      }
    };

    // ── Merge updated fields into formData per type ──
    if (request.type === DevelopmentOptionType.TASK_OFFLOADING) {
      const formData = { ...(request.formData as Record<string, unknown>) };
      mergeKeys(formData, [
        'projectTitle',
        'requestSubject',
        'startDate',
        'endDate',
        'reason',
        'projectDescription',
        'scopeOfWork',
        'successMetrics',
        'expectedDeliverables',
        'businessAlignment',
        'developmentGoals',
        'taskToOffload',
        'colleagueName',
      ]);

      // Validate the effective range (merging any unchanged dates from the original).
      this.assertValidDateRange(
        formData.startDate as string,
        formData.endDate as string,
      );
      this.assertProjectDurationWithinLimit(
        formData.startDate as string,
        formData.endDate as string,
      );

      if (dto.attachmentUrl) request.attachmentUrl = dto.attachmentUrl;
      request.formData = formData;
    } else if (request.type === DevelopmentOptionType.COACHING) {
      const formData = { ...(request.formData as Record<string, unknown>) };
      if (dto.coachId) {
        const coach = await this.userRepo.findOne({ where: { id: dto.coachId } });
        if (!coach) throw new NotFoundException('Coach not found');
        if (!coach.roles.includes(UserRole.COACH)) {
          throw new BadRequestException('The selected employee does not have the coach role');
        }
        if (coach.id === employeeId) {
          throw new BadRequestException('You cannot nominate yourself as your coach');
        }
        formData.coachId = coach.id;
        formData.coachName = `${coach.firstName} ${coach.lastName}`;
      }
      mergeKeys(formData, [
        'notes',
        'focusArea',
        'developmentObjective',
        'keyChallenges',
        'expectedOutcomes',
        'preferredSchedule',
      ]);
      if (dto.attachmentUrl) request.attachmentUrl = dto.attachmentUrl;
      request.formData = formData;
    } else if (request.type === DevelopmentOptionType.LEARNING_SUBSIDY) {
      const formData = { ...(request.formData as Record<string, unknown>) };
      if (dto.subsidyAmount !== undefined) {
        const option = await this.optionRepo.findOne({ where: { id: request.developmentOptionId } });
        const subsidyPerToken = (option?.rules as Record<string, number>)?.subsidyPerToken ?? 1000;
        const maxTokens = (option?.rules as Record<string, number>)?.maxTokens ?? 3;
        const newTokenCost = Math.ceil(dto.subsidyAmount / subsidyPerToken);
        if (newTokenCost > maxTokens) {
          throw new BadRequestException(
            `Subsidy amount ₱${dto.subsidyAmount} exceeds the maximum of ₱${maxTokens * subsidyPerToken}`,
          );
        }
        // Re-check balance with new cost
        const year = new Date().getFullYear();
        const balance = await this.tokenBalancesService.getBalance(employeeId, year);
        if (balance.remaining < newTokenCost) {
          throw new BadRequestException(
            `Insufficient tokens. Required: ${newTokenCost}, Available: ${balance.remaining}`,
          );
        }
        formData.subsidyAmount = dto.subsidyAmount;
        formData.tokenCost = newTokenCost;
        request.tokenCost = newTokenCost;
      }
      mergeKeys(formData, [
        'courseName',
        'provider',
        'startDate',
        'endDate',
        'modeOfTraining',
        'totalCost',
        'learningDescription',
        'businessAlignment',
        'applicationPlan',
        'duringWorkHours',
        'reimbursementType',
      ]);

      // Re-validate the effective date range and cost/amount relationship.
      if (formData.startDate && formData.endDate) {
        this.assertValidDateRange(
          formData.startDate as string,
          formData.endDate as string,
        );
      }
      const effectiveAmount = formData.subsidyAmount as number | undefined;
      const effectiveTotal = formData.totalCost as number | undefined;
      if (
        effectiveAmount != null &&
        effectiveTotal != null &&
        effectiveAmount > effectiveTotal
      ) {
        throw new BadRequestException(
          `Subsidy amount ₱${effectiveAmount.toLocaleString()} cannot exceed the total training cost of ₱${effectiveTotal.toLocaleString()}`,
        );
      }

      if (dto.attachmentUrl) request.attachmentUrl = dto.attachmentUrl;
      request.formData = formData;
    }

    // ── Reset status and clear rejection fields ──
    request.status = RequestStatus.PENDING;
    request.rejectedById = null as any;
    request.rejectedByLevel = null as any;
    request.rejectionComment = null as any;
    request.rejectedAt = null as any;
    // Back at the start of the pipeline — the SLA clock starts over.
    request.slaRemindedAt = null;
    request.slaEscalatedAt = null;
    request.managerApprovedAt = null as any;
    // The rejection this resubmit answers is no longer reversible — the employee
    // has already moved the request on. (The status guard in undoDecision would
    // catch this anyway; clearing keeps the row honest.)
    this.clearDecision(request);

    await this.requestRepo.save(request);
    this.logger.log(`Request ${requestId} resubmitted by employee ${employeeId}`);

    // ── Re-notify manager/coach ──
    const manager = await this.userRepo.findOne({ where: { id: request.managerId } });
    if (manager) {
      try {
        await this.emailService.sendFirstLevelReviewNotification({
          approverEmail: manager.email,
          approverName: `${manager.firstName} ${manager.lastName}`,
          approverRole: request.type === DevelopmentOptionType.COACHING ? 'Coach' : 'Manager',
          employeeName: `${request.employee.firstName} ${request.employee.lastName}`,
          optionName: request.developmentOption?.name ?? request.type,
          tokenCost: request.tokenCost,
          submissionDate: new Date(),
          requestId: request.id,
        });
      } catch (err: unknown) {
        this.logger.warn(`Failed to send resubmit notification: ${(err as Error).message}`);
      }
    }

    return this.findRequest(requestId);
  }
  // ─── Queries ──────────────────────────────────────────────────────────────────

  /** Employee: their own requests, newest first. */
  async findMyRequests(employeeId: string): Promise<TokenRequest[]> {
    return this.requestRepo.find({
      where: { employeeId },
      relations: ['developmentOption'],
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Combined approval queue for the current user.
   * - If user has `approver` role: includes their pending requests (status = pending, managerId = user.id)
   * - If user has `hr_approver` role: includes manager-approved requests (status = manager_approved)
   * Each item is tagged with `queueType: 'manager' | 'hr'` so the frontend knows which buttons to show.
   */
  async findApprovalQueue(
    user: User,
  ): Promise<(TokenRequest & { queueType: 'manager' | 'hr' })[]> {
    const results: (TokenRequest & { queueType: 'manager' | 'hr' })[] = [];

    // Managers (approver role) see pending non-coaching requests assigned to them.
    if (user.roles.includes(UserRole.APPROVER) || user.roles.includes(UserRole.ADMIN as UserRole)) {
      const managerItems = await this.requestRepo.find({
        where: { managerId: user.id, status: RequestStatus.PENDING },
        relations: ['employee', 'developmentOption'],
        order: { createdAt: 'ASC' },
      });
      results.push(...managerItems.map((r) => Object.assign(r, { queueType: 'manager' as const })));
    }

    // Coaches see pending coaching requests where they are the assigned coach (managerId = their id).
    if (user.roles.includes(UserRole.COACH)) {
      const coachItems = await this.requestRepo.find({
        where: {
          managerId: user.id,
          status: RequestStatus.PENDING,
          type: DevelopmentOptionType.COACHING,
        },
        relations: ['employee', 'developmentOption'],
        order: { createdAt: 'ASC' },
      });
      // Only add items not already in results (in case user has both coach + approver roles)
      const existingIds = new Set(results.map((r) => r.id));
      results.push(
        ...coachItems
          .filter((r) => !existingIds.has(r.id))
          .map((r) => Object.assign(r, { queueType: 'manager' as const })),
      );
    }

    if (
      user.roles.includes(UserRole.HR_APPROVER as UserRole) ||
      user.roles.includes(UserRole.ADMIN as UserRole)
    ) {
      const hrItems = await this.requestRepo.find({
        where: { status: RequestStatus.MANAGER_APPROVED },
        relations: ['employee', 'manager', 'developmentOption'],
        order: { managerApprovedAt: 'ASC' },
      });
      results.push(...hrItems.map((r) => Object.assign(r, { queueType: 'hr' as const })));
    }

    return results;
  }

  /**
   * Manager: full history of all requests they have been assigned to,
   * regardless of current status. Optional tab filter:
   *   tab=pending   → status = pending (still awaiting their action)
   *   tab=approved  → manager_approved + approved (they already approved)
   *   tab=rejected  → rejected + cancelled
   */
  /**
   * Unified approval history for all approver roles.
   *
   * Role behaviour:
   *   admin       → all requests, tab maps to broad status groups
   *   approver    → requests where managerId = user.id (their direct queue)
   *   coach       → coaching requests where managerId = user.id
   *   hr_approver → all manager_approved (pending their action)
   *                 + requests where hrId = user.id (they approved)
   *                 + requests they rejected at HR level
   *   multi-role  → union of applicable sets, deduplicated
   *
   * Tab filter (meaning varies by role — see inline comments):
   *   pending  → approver/coach: status=pending | hr: status=manager_approved | admin: pending+manager_approved
   *   approved → approver/coach: manager_approved+approved | hr: approved they acted on | admin: approved
   *   rejected → approver/coach: rejected+cancelled | hr: rejected they acted on | admin: rejected+cancelled
   */
  async findApprovalHistory(user: User, tab?: string): Promise<TokenRequest[]> {
    const roles = user.roles as string[];
    const isAdmin   = roles.includes(UserRole.ADMIN as string);
    const isHr      = roles.includes('hr_approver');
    const isManager = roles.includes(UserRole.APPROVER as string);
    const isCoach   = roles.includes(UserRole.COACH as string);

    // ── Admin: full table, broad tab groups ────────────────────────────────
    if (isAdmin) {
      const adminStatusMap: Record<string, object> = {
        pending:  { status: In([RequestStatus.PENDING, RequestStatus.MANAGER_APPROVED as RequestStatus]) },
        approved: { status: RequestStatus.APPROVED },
        rejected: { status: In([RequestStatus.REJECTED, RequestStatus.CANCELLED]) },
      };
      return this.requestRepo.find({
        where: tab && adminStatusMap[tab] ? adminStatusMap[tab] : {},
        relations: ['employee', 'manager', 'developmentOption'],
        order: { createdAt: 'DESC' },
      });
    }

    const whereConditions: object[] = [];

    // ── Manager / Coach: requests assigned to them ─────────────────────────
    // Both roles store the user as managerId, so one condition covers both.
    if (isManager || isCoach) {
      const managerTabMap: Record<string, object> = {
        pending:  { status: RequestStatus.PENDING },
        approved: { status: In([RequestStatus.MANAGER_APPROVED as RequestStatus, RequestStatus.APPROVED]) },
        rejected: { status: In([RequestStatus.REJECTED, RequestStatus.CANCELLED]) },
      };
      const statusClause = tab && managerTabMap[tab] ? managerTabMap[tab] : {};
      whereConditions.push({ managerId: user.id, ...statusClause });
    }

    // ── HR Approver: requests they need to act on / have acted on ──────────
    if (isHr) {
      if (!tab) {
        // No filter: everything in HR scope
        whereConditions.push(
          { status: RequestStatus.MANAGER_APPROVED as RequestStatus },   // awaiting their action
          { hrId: user.id },                                              // they approved
          { rejectedById: user.id, rejectedByLevel: 'hr' },              // they rejected
        );
      } else if (tab === 'pending') {
        // "Pending" for HR = requests awaiting their final review (company-wide)
        whereConditions.push({ status: RequestStatus.MANAGER_APPROVED as RequestStatus });
      } else if (tab === 'approved') {
        // Requests they personally approved
        whereConditions.push({ status: RequestStatus.APPROVED, hrId: user.id });
      } else if (tab === 'rejected') {
        // Requests they personally rejected
        whereConditions.push({ rejectedById: user.id, rejectedByLevel: 'hr' });
      }
    }

    if (whereConditions.length === 0) return [];

    const results = await this.requestRepo.find({
      where: whereConditions,
      relations: ['employee', 'manager', 'developmentOption'],
      order: { createdAt: 'DESC' },
    });

    // Deduplicate by ID in case user has overlapping roles
    const seen = new Set<string>();
    return results.filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });
  }

  /** @deprecated Use findApprovalQueue instead */
  async findHrQueue(): Promise<TokenRequest[]> {
    return this.requestRepo.find({
      where: { status: RequestStatus.MANAGER_APPROVED },
      relations: ['employee', 'manager', 'developmentOption'],
      order: { managerApprovedAt: 'ASC' },
    });
  }

  /**
   * Admin: all requests.
   * Filter priority: tab > status > none.
   * tab=active      → pending + manager_approved
   * tab=completed   → approved
   * tab=rejected    → rejected + cancelled
   */
  async findAll(status?: RequestStatus, tab?: string): Promise<TokenRequest[]> {
    const TAB_STATUSES: Record<string, RequestStatus[]> = {
      active: [RequestStatus.PENDING, RequestStatus.MANAGER_APPROVED as RequestStatus],
      completed: [RequestStatus.APPROVED],
      rejected: [RequestStatus.REJECTED, RequestStatus.CANCELLED],
    };

    let where: object = {};
    if (tab && TAB_STATUSES[tab]) {
      where = { status: In(TAB_STATUSES[tab]) };
    } else if (status) {
      where = { status };
    }

    return this.requestRepo.find({
      where,
      relations: ['employee', 'manager', 'hr', 'developmentOption'],
      order: { createdAt: 'DESC' },
    });
  }

  /** Get one request by ID. */
  async findOne(id: string): Promise<TokenRequest> {
    return this.findRequest(id);
  }
}
