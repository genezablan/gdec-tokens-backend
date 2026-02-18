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
import { CreateTokenRequestDto } from './dto/create-token-request.dto';
import { RejectTokenRequestDto } from './dto/reject-token-request.dto';

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
    if (employee.immediateSupervisorId) {
      const supervisor = await this.userRepo.findOne({
        where: { id: employee.immediateSupervisorId },
      });
      if (supervisor && supervisor.roles.includes(UserRole.APPROVER)) {
        return supervisor;
      }
    }
    // Fallback: any admin
    const admin = await this.userRepo.findOne({
      where: { roles: [UserRole.ADMIN] as any },
    });
    if (!admin) throw new BadRequestException('No approver found for this employee');
    return admin;
  }

  // ─── Submit ──────────────────────────────────────────────────────────────────

  async create(employeeId: string, dto: CreateTokenRequestDto): Promise<TokenRequest> {
    const employee = await this.userRepo.findOne({ where: { id: employeeId } });
    if (!employee) throw new NotFoundException('Employee not found');

    const option = await this.optionRepo.findOne({ where: { id: dto.developmentOptionId } });
    if (!option) throw new NotFoundException('Development option not found');
    if (!option.isActive) throw new BadRequestException('This development option is currently inactive');

    const year = new Date().getFullYear();

    // ── Consecutive-year check for task offloading ──
    if (option.type === DevelopmentOptionType.TASK_OFFLOADING) {
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
    }

    // ── Token balance check ──
    const balance = await this.tokenBalancesService.getBalance(employeeId, year);
    if (balance.remaining < option.tokenCost) {
      throw new BadRequestException(
        `Insufficient tokens. Required: ${option.tokenCost}, Available: ${balance.remaining}`,
      );
    }

    // ── Resolve manager ──
    const manager = await this.resolveManager(employee);

    const request = this.requestRepo.create({
      employeeId,
      developmentOptionId: option.id,
      type: option.type,
      tokenCost: option.tokenCost, // snapshot
      year,
      status: RequestStatus.PENDING,
      managerId: manager.id,
      formData: dto.formData,
      attachmentUrl: dto.attachmentUrl,
    });

    await this.requestRepo.save(request);
    this.logger.log(`Token request created: ${request.id} by employee ${employeeId}`);

    // ── Notify manager ──
    try {
      await this.emailService.sendRequestNotification(
        manager.email,
        `${employee.firstName} ${employee.lastName}`,
        option.name,
        request.id,
      );
    } catch (err: unknown) {
      this.logger.warn(`Failed to send manager notification: ${(err as Error).message}`);
    }

    return this.findRequest(request.id);
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
    const hrUser = await this.userRepo.findOne({
      where: { roles: [UserRole.HR_APPROVER] as any, isActive: true },
    });

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
    }}

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

  // ─── Queries ──────────────────────────────────────────────────────────────────

  /** Employee: their own requests, newest first. */
  async findMyRequests(employeeId: string): Promise<TokenRequest[]> {
    return this.requestRepo.find({
      where: { employeeId },
      relations: ['developmentOption'],
      order: { createdAt: 'DESC' },
    });
  }

  /** Manager: pending requests assigned to them. */
  async findPendingForManager(managerId: string): Promise<TokenRequest[]> {
    return this.requestRepo.find({
      where: { managerId, status: RequestStatus.PENDING },
      relations: ['employee', 'developmentOption'],
      order: { createdAt: 'ASC' },
    });
  }

  /** HR: requests awaiting final approval. */
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
