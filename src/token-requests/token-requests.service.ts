import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TokenRequest } from '../entities/token-request.entity';
import { User } from '../entities/user.entity';
import { DevelopmentOption } from '../entities/development-option.entity';
import { TokenBalancesService } from '../token-balances/token-balances.service';
import { EmailService } from '../common/services/email.service';
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

    try {
      await this.emailService.sendRequestNotification(
        manager.email,
        `${employee.firstName} ${employee.lastName}`,
        request.type,
        request.id,
      );
    } catch (err: unknown) {
      this.logger.warn(`Failed to send manager notification: ${(err as Error).message}`);
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
      formData: {},
      attachmentUrl: dto.attachmentUrl,
    });
  }

  /**
   * POST /token-requests/coaching
   * Costs 2 tokens. Coach must exist and have the coach role.
   */
  async createCoaching(
    employeeId: string,
    dto: CreateCoachingRequestDto,
  ): Promise<TokenRequest> {
    const { employee, option, year, balance, manager } = await this.prepareRequest(
      employeeId,
      dto.developmentOptionId,
      DevelopmentOptionType.COACHING,
    );

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

    return this.saveAndNotify({
      employeeId,
      optionId: option.id,
      optionType: option.type,
      tokenCost: option.tokenCost,
      year,
      managerId: manager.id,
      employee,
      manager,
      formData: {
        coachId: dto.coachId,
        coachName: `${coach.firstName} ${coach.lastName}`,
        notes: dto.notes ?? null,
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
        subsidyAmount: dto.subsidyAmount,
        tokenCost,
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
    const hrUser = await this.userRepo
      .createQueryBuilder('user')
      .where(':role = ANY(user.roles)', { role: UserRole.HR_APPROVER })
      .andWhere('user.isActive = true')
      .getOne();

    if (hrUser) {
      try {
        await this.emailService.sendRequestNotification(
          hrUser.email,
          `${request.employee.firstName} ${request.employee.lastName}`,
          request.developmentOption.name,
          request.id,
        );
      } catch (err: unknown) {
        this.logger.warn(`Failed to send HR notification: ${(err as Error).message}`);
      }
    }

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
      await this.emailService.sendApprovalNotification(
        request.employee.email,
        `${request.employee.firstName} ${request.employee.lastName}`,
        request.developmentOption?.name ?? request.type,
      );
    } catch (err: unknown) {
      this.logger.warn(`Failed to send approval email: ${(err as Error).message}`);
    }

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
      await this.emailService.sendRejectionNotification(
        request.employee.email,
        `${request.employee.firstName} ${request.employee.lastName}`,
        request.developmentOption?.name ?? request.type,
        dto.comment,
      );
    } catch (err: unknown) {
      this.logger.warn(`Failed to send rejection email: ${(err as Error).message}`);
    }

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
      if (dto.attachmentUrl) {
        request.attachmentUrl = dto.attachmentUrl;
      }
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

    // ── Re-notify manager ──
    const manager = await this.userRepo.findOne({ where: { id: request.managerId } });
    if (manager) {
      try {
        await this.emailService.sendRequestNotification(
          manager.email,
          `${request.employee.firstName} ${request.employee.lastName}`,
          request.type,
          request.id,
        );
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

    if (user.roles.includes(UserRole.APPROVER) || user.roles.includes(UserRole.ADMIN as UserRole)) {
      const managerItems = await this.requestRepo.find({
        where: { managerId: user.id, status: RequestStatus.PENDING },
        relations: ['employee', 'developmentOption'],
        order: { createdAt: 'ASC' },
      });
      results.push(...managerItems.map((r) => Object.assign(r, { queueType: 'manager' as const })));
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

  /** @deprecated Use findApprovalQueue instead */
  async findHrQueue(): Promise<TokenRequest[]> {
    return this.requestRepo.find({
      where: { status: RequestStatus.MANAGER_APPROVED },
      relations: ['employee', 'manager', 'developmentOption'],
      order: { managerApprovedAt: 'ASC' },
    });
  }

  /** Admin: all requests, optionally filtered by status. */
  async findAll(status?: RequestStatus): Promise<TokenRequest[]> {
    const where = status ? { status } : {};
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
