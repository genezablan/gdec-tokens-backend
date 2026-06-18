import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { TokenRequest } from '../entities/token-request.entity';
import { User } from '../entities/user.entity';
import { DevelopmentOption } from '../entities/development-option.entity';
import { TokenBalancesService } from '../token-balances/token-balances.service';
import { EmailService } from '../common/services/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../entities/notification.entity';
import { RequestStatus, UserRole, DevelopmentOptionType } from '../common/enums';
import { CreateTaskOffloadingRequestDto } from './dto/create-task-offloading-request.dto';
import { CreateCoachingRequestDto } from './dto/create-coaching-request.dto';
import { CreateLearningSubsidyRequestDto } from './dto/create-learning-subsidy-request.dto';
import { RejectTokenRequestDto } from './dto/reject-token-request.dto';
import { ResubmitTokenRequestDto } from './dto/resubmit-token-request.dto';

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
   * Validate a task-offloading date range. The frontend enforces this too, but
   * the backend must be authoritative (direct API calls bypass the UI).
   */
  private assertValidDateRange(startDate: string, endDate: string): void {
    if (new Date(endDate) < new Date(startDate)) {
      throw new BadRequestException('End date cannot be before start date.');
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

    if (balance.remaining < option.tokenCost) {
      throw new BadRequestException(
        `Insufficient tokens. Required: ${option.tokenCost}, Available: ${balance.remaining}`,
      );
    }

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

    if (balance.remaining < option.tokenCost) {
      throw new BadRequestException(
        `Insufficient tokens. Required: ${option.tokenCost}, Available: ${balance.remaining}`,
      );
    }

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
        preferredSchedule: dto.formData.preferredSchedule,
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
    if (balance.remaining < tokenCost) {
      throw new BadRequestException(
        `Insufficient tokens. Required: ${tokenCost}, Available: ${balance.remaining}`,
      );
    }

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

    request.status = RequestStatus.MANAGER_APPROVED;
    request.managerApprovedAt = new Date();
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
        title: 'Request Pending HR Approval',
        message: `${request.employee.firstName} ${request.employee.lastName}'s ${(request.developmentOption?.name ?? request.type).replace(/_/g, ' ')} request has been approved by the ${request.type === DevelopmentOptionType.COACHING ? 'coach' : 'manager'} and needs your review.`,
        type: NotificationType.INFO,
        requestId: request.id,
        metadata: { deeplink: '/approval' },
      }).catch(() => {});
    }

    // ── In-app: notify employee that manager approved ──
    this.notificationsService.create(request.employeeId, {
      title: 'Request Approved by Manager',
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
    await this.requestRepo.save(request);
    this.logger.log(`Request ${requestId} HR-approved by ${hrUserId}`);

    // ── Deduct tokens ──
    await this.tokenBalancesService.deductTokens(request.employeeId, request.year, request.tokenCost);

    // ── Notify employee ──
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

    // ── In-app: notify employee final approval ──
    this.notificationsService.create(request.employeeId, {
      title: 'Request Approved! 🎉',
      message: `Your ${(request.developmentOption?.name ?? request.type).replace(/_/g, ' ')} request has been fully approved. ${request.tokenCost} token${request.tokenCost !== 1 ? 's' : ''} have been deducted.`,
      type: NotificationType.SUCCESS,
      requestId: request.id,
      metadata: {
        deeplink: request.type === DevelopmentOptionType.COACHING
          ? `/coaching/${request.id}/sessions`
          : '/my-request',
      },
    }).catch(() => {});

    return this.findRequest(requestId);
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

    request.status = RequestStatus.REJECTED;
    request.rejectedById = rejectorId;
    request.rejectedByLevel = level;
    request.rejectionComment = dto.comment;
    request.rejectedAt = new Date();
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
      title: 'Request Not Approved',
      message: `Your ${(request.developmentOption?.name ?? request.type).replace(/_/g, ' ')} request was not approved. Reason: ${dto.comment}`,
      type: NotificationType.ERROR,
      requestId: request.id,
      metadata: { deeplink: '/my-request' },
    }).catch(() => {});

    return this.findRequest(requestId);
  }

  // ─── Cancel ───────────────────────────────────────────────────────────────────

  async cancel(requestId: string, employeeId: string): Promise<TokenRequest> {
    const request = await this.findRequest(requestId);

    if (request.employeeId !== employeeId) {
      throw new ForbiddenException('You can only cancel your own requests');
    }
    if (request.status !== RequestStatus.PENDING) {
      throw new BadRequestException(
        `Only pending requests can be cancelled (current: ${request.status})`,
      );
    }

    request.status = RequestStatus.CANCELLED;
    request.cancelledAt = new Date();
    await this.requestRepo.save(request);
    this.logger.log(`Request ${requestId} cancelled by employee ${employeeId}`);

    return this.findRequest(requestId);
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

    // ── Merge updated fields into formData per type ──
    if (request.type === DevelopmentOptionType.TASK_OFFLOADING) {
      const formData = { ...(request.formData as Record<string, unknown>) };
      if (dto.requestSubject !== undefined) formData.requestSubject = dto.requestSubject;
      if (dto.startDate !== undefined) formData.startDate = dto.startDate;
      if (dto.endDate !== undefined) formData.endDate = dto.endDate;
      if (dto.reason !== undefined) formData.reason = dto.reason;

      // Validate the effective range (merging any unchanged dates from the original).
      this.assertValidDateRange(
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
      if (dto.notes !== undefined) formData.notes = dto.notes;
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
      if (dto.courseName !== undefined) formData.courseName = dto.courseName;
      if (dto.provider !== undefined) formData.provider = dto.provider;
      if (dto.attachmentUrl) request.attachmentUrl = dto.attachmentUrl;
      request.formData = formData;
    }

    // ── Reset status and clear rejection fields ──
    request.status = RequestStatus.PENDING;
    request.rejectedById = null as any;
    request.rejectedByLevel = null as any;
    request.rejectionComment = null as any;
    request.rejectedAt = null as any;

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
