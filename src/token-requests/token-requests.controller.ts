import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { TokenRequestsService } from './token-requests.service';
import { CreateTokenRequestDto } from './dto/create-token-request.dto';
import { RejectTokenRequestDto } from './dto/reject-token-request.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { User } from '../entities/user.entity';
import { UserRole, RequestStatus } from '../common/enums';

@Controller('token-requests')
export class TokenRequestsController {
  constructor(private readonly tokenRequestsService: TokenRequestsService) {}

  /**
   * POST /token-requests
   * Employee: submit a new token request.
   */
  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateTokenRequestDto) {
    return this.tokenRequestsService.create(user.id, dto);
  }

  /**
   * GET /token-requests/my
   * Employee: view their own request history.
   */
  @Get('my')
  getMyRequests(@CurrentUser() user: User) {
    return this.tokenRequestsService.findMyRequests(user.id);
  }

  /**
   * GET /token-requests/pending
   * Manager (approver): view pending requests assigned to them.
   */
  @Get('pending')
  @Roles(UserRole.APPROVER, UserRole.ADMIN)
  getPendingForManager(@CurrentUser() user: User) {
    return this.tokenRequestsService.findPendingForManager(user.id);
  }

  /**
   * GET /token-requests/hr-queue
   * HR approver: view manager-approved requests awaiting final HR approval.
   */
  @Get('hr-queue')
  @Roles(UserRole.HR_APPROVER as UserRole, UserRole.ADMIN)
  getHrQueue() {
    return this.tokenRequestsService.findHrQueue();
  }

  /**
   * GET /token-requests
   * Admin: view all requests, optionally filtered by status.
   * ?status=pending | manager_approved | approved | rejected | cancelled
   */
  @Get()
  @Roles(UserRole.ADMIN)
  findAll(@Query('status') status?: RequestStatus) {
    return this.tokenRequestsService.findAll(status);
  }

  /**
   * GET /token-requests/:id
   * Get a single request by ID.
   */
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.tokenRequestsService.findOne(id);
  }

  /**
   * PATCH /token-requests/:id/manager-approve
   * Manager: approve a pending request (moves to manager_approved).
   */
  @Patch(':id/manager-approve')
  @Roles(UserRole.APPROVER, UserRole.ADMIN)
  managerApprove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return this.tokenRequestsService.managerApprove(id, user.id);
  }

  /**
   * PATCH /token-requests/:id/hr-approve
   * HR approver: final approval — deducts tokens and notifies employee.
   */
  @Patch(':id/hr-approve')
  @Roles(UserRole.HR_APPROVER as UserRole, UserRole.ADMIN)
  hrApprove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return this.tokenRequestsService.hrApprove(id, user.id);
  }

  /**
   * PATCH /token-requests/:id/manager-reject
   * Manager: reject a pending request.
   */
  @Patch(':id/manager-reject')
  @Roles(UserRole.APPROVER, UserRole.ADMIN)
  managerReject(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Body() dto: RejectTokenRequestDto,
  ) {
    return this.tokenRequestsService.reject(id, user.id, dto, 'manager');
  }

  /**
   * PATCH /token-requests/:id/hr-reject
   * HR approver: reject a request at any stage.
   */
  @Patch(':id/hr-reject')
  @Roles(UserRole.HR_APPROVER as UserRole, UserRole.ADMIN)
  hrReject(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Body() dto: RejectTokenRequestDto,
  ) {
    return this.tokenRequestsService.reject(id, user.id, dto, 'hr');
  }

  /**
   * PATCH /token-requests/:id/cancel
   * Employee: cancel their own pending request.
   */
  @Patch(':id/cancel')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return this.tokenRequestsService.cancel(id, user.id);
  }
}
