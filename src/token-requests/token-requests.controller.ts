import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { TokenRequestsService } from './token-requests.service';
import { CoachingSessionsService } from './coaching-sessions.service';
import { CreateTaskOffloadingRequestDto } from './dto/create-task-offloading-request.dto';
import { CreateCoachingRequestDto } from './dto/create-coaching-request.dto';
import { CreateLearningSubsidyRequestDto } from './dto/create-learning-subsidy-request.dto';
import { RejectTokenRequestDto } from './dto/reject-token-request.dto';
import { ResubmitTokenRequestDto } from './dto/resubmit-token-request.dto';
import { BookSessionDto } from './dto/book-session.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { User } from '../entities/user.entity';
import { UserRole, RequestStatus } from '../common/enums';
import { S3Service } from '../common/services/s3.service';

@Controller('token-requests')
export class TokenRequestsController {
  constructor(
    private readonly tokenRequestsService: TokenRequestsService,
    private readonly coachingSessionsService: CoachingSessionsService,
    private readonly s3Service: S3Service,
  ) {}

  /**
   * POST /token-requests/upload-attachment
   * Employee: pre-upload a supporting document to S3 before submitting the request.
   * Returns { url, key, fileName } to pass as attachmentUrl in the create request body.
   * Accepts multipart/form-data with field name 'file'.
   */
  @Post('upload-attachment')
  @UseInterceptors(FileInterceptor('file'))
  async uploadAttachment(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: User,
  ) {
    if (!file) throw new BadRequestException('No file provided');
    const result = await this.s3Service.uploadPendingAttachment(
      file.buffer,
      user.id,
      file.originalname,
      file.mimetype,
    );
    return { url: result.url, key: result.key, fileName: file.originalname };
  }

  /**
   * POST /token-requests/task-offloading
   * Employee: submit a Task Offloading request (1 token).
   */
  @Post('task-offloading')
  createTaskOffloading(
    @CurrentUser() user: User,
    @Body() dto: CreateTaskOffloadingRequestDto,
  ) {
    return this.tokenRequestsService.createTaskOffloading(user.id, dto);
  }

  /**
   * POST /token-requests/coaching
   * Employee: submit an Internal Coaching request (2 tokens).
   */
  @Post('coaching')
  createCoaching(
    @CurrentUser() user: User,
    @Body() dto: CreateCoachingRequestDto,
  ) {
    return this.tokenRequestsService.createCoaching(user.id, dto);
  }

  /**
   * POST /token-requests/learning-subsidy
   * Employee: submit a Learning Subsidy request (1–3 tokens based on subsidyAmount).
   */
  @Post('learning-subsidy')
  createLearningSubsidy(
    @CurrentUser() user: User,
    @Body() dto: CreateLearningSubsidyRequestDto,
  ) {
    return this.tokenRequestsService.createLearningSubsidy(user.id, dto);
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
   * Combined approval queue — returns items from both manager queue and HR queue
   * depending on the current user's roles. Each item includes `queueType: 'manager' | 'hr'`.
   * Accessible to: approver, hr_approver, admin.
   */
  @Get('pending')
  @Roles(UserRole.APPROVER, UserRole.HR_APPROVER as UserRole, UserRole.ADMIN)
  getApprovalQueue(@CurrentUser() user: User) {
    return this.tokenRequestsService.findApprovalQueue(user);
  }

  /**
   * GET /token-requests/hr-queue
   * @deprecated Use GET /token-requests/pending instead.
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
   * PATCH /token-requests/:id/resubmit
   * Employee: update and resubmit a rejected request back to pending.
   */
  @Patch(':id/resubmit')
  resubmit(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Body() dto: ResubmitTokenRequestDto,
  ) {
    return this.tokenRequestsService.resubmit(id, user.id, dto);
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

  // ─── Coaching Sessions ────────────────────────────────────────────────────────

  /**
   * GET /token-requests/:id/sessions
   * View all coaching sessions for a request.
   * Accessible to the employee, the coach, approvers, and admins.
   */
  @Get(':id/sessions')
  getSessions(@Param('id', ParseUUIDPipe) id: string) {
    return this.coachingSessionsService.findSessions(id);
  }

  /**
   * POST /token-requests/:id/sessions
   * Book the next session slot (1 → 2 → 3) for an approved coaching request.
   * Either the employee or the assigned coach can book.
   */
  @Post(':id/sessions')
  bookSession(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Body() dto: BookSessionDto,
  ) {
    return this.coachingSessionsService.bookSession(id, user.id, dto);
  }

  /**
   * PATCH /token-requests/:id/sessions/:sessionId/complete
   * Coach marks a session as completed, optionally with notes.
   * Body: { notes?: string }
   */
  @Patch(':id/sessions/:sessionId/complete')
  @Roles(UserRole.COACH, UserRole.ADMIN)
  completeSession(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: User,
    @Body('notes') notes?: string,
  ) {
    return this.coachingSessionsService.completeSession(id, sessionId, user.id, notes);
  }

  /**
   * PATCH /token-requests/:id/sessions/:sessionId/no-show
   * Coach marks the employee as a no-show. Releases the slot for rebooking.
   */
  @Patch(':id/sessions/:sessionId/no-show')
  @Roles(UserRole.COACH, UserRole.ADMIN)
  markNoShow(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: User,
  ) {
    return this.coachingSessionsService.markNoShow(id, sessionId, user.id);
  }

  /**
   * DELETE /token-requests/:id/sessions/:sessionId
   * Cancel a scheduled session. Releases the availability slot.
   * Either the employee or the coach can cancel.
   */
  @Delete(':id/sessions/:sessionId')
  cancelSession(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: User,
  ) {
    return this.coachingSessionsService.cancelSession(id, sessionId, user.id);
  }
}
