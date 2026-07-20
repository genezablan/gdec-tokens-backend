import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  BadRequestException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { TokenRequestsService } from './token-requests.service';
import { CoachingSessionsService } from './coaching-sessions.service';
import { CreateTaskOffloadingRequestDto } from './dto/create-task-offloading-request.dto';
import { CreateCoachingRequestDto } from './dto/create-coaching-request.dto';
import { CreateLearningSubsidyRequestDto } from './dto/create-learning-subsidy-request.dto';
import { RejectTokenRequestDto } from './dto/reject-token-request.dto';
import { ResubmitTokenRequestDto } from './dto/resubmit-token-request.dto';
import { BookSessionDto } from './dto/book-session.dto';
import { RequestCancelSessionDto } from './dto/request-cancel-session.dto';
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
   * GET /token-requests/presigned-upload?fileName=x&contentType=y
   * Returns a pre-signed S3 PUT URL. Browser uploads the file directly to S3,
   * then passes fileUrl as attachmentUrl when submitting the request.
   */
  @Get('presigned-upload')
  async getPresignedUploadUrl(
    @Query('fileName') fileName: string,
    @Query('contentType') contentType: string,
    @CurrentUser() user: User,
  ) {
    if (!fileName) throw new BadRequestException('fileName query param is required');
    if (!contentType) throw new BadRequestException('contentType query param is required');
    return await this.s3Service.generatePresignedUploadUrl(user.id, fileName, contentType);
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
   * Accessible to: approver, coach, hr_approver, admin.
   * Coaches see their assigned pending coaching requests.
   */
  @Get('pending')
  @Roles(UserRole.APPROVER, UserRole.COACH, UserRole.HR_APPROVER as UserRole, UserRole.ADMIN)
  getApprovalQueue(@CurrentUser() user: User) {
    return this.tokenRequestsService.findApprovalQueue(user);
  }

  /**
   * GET /token-requests/my-approvals
   * Role-aware approval history. Behaviour varies by role:
   *   approver    → all requests assigned to them as manager (all statuses)
   *   coach       → coaching requests assigned to them as coach (all statuses)
   *   hr_approver → all manager_approved (pending their action) + requests they acted on
   *   admin       → all requests company-wide
   *
   * Tab filter (meaning differs per role):
   *   ?tab=pending  → approver/coach: their pending queue
   *                   hr_approver: requests awaiting final HR review (manager_approved)
   *                   admin: pending + manager_approved
   *   ?tab=approved → approver/coach: manager_approved + approved
   *                   hr_approver: approved requests they personally approved
   *                   admin: approved
   *   ?tab=rejected → approver/coach: rejected + cancelled
   *                   hr_approver: requests they personally rejected at HR level
   *                   admin: rejected + cancelled
   */
  @Get('my-approvals')
  @Roles(UserRole.APPROVER, UserRole.COACH, UserRole.HR_APPROVER as UserRole, UserRole.ADMIN)
  getMyApprovals(
    @CurrentUser() user: User,
    @Query('tab') tab?: string,
  ) {
    return this.tokenRequestsService.findApprovalHistory(user, tab);
  }

  /**
   * GET /token-requests/coaching/my-overview
   * Coach: get all coaching requests assigned to them (pending/manager_approved/approved),
   * each with their sessions embedded. Used to power the "My Sessions" page.
   */
  @Get('coaching/my-overview')
  @Roles(UserRole.COACH, UserRole.ADMIN)
  getCoachOverview(@CurrentUser() user: User) {
    return this.coachingSessionsService.findCoachOverview(user.id);
  }

  /**
   * GET /token-requests/coaching/my-events
   * Any user: their coaching sessions (as coach OR employee) as dated calendar
   * events. Powers the navbar calendar popover.
   */
  @Get('coaching/my-events')
  getMyCoachingEvents(@CurrentUser() user: User) {
    return this.coachingSessionsService.findMyEvents(user.id);
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
   * Admin: view all requests.
   * Filter by exact status: ?status=pending | manager_approved | approved | rejected | cancelled
   * Filter by tab group:    ?tab=active | completed | rejected
   *   active    → pending + manager_approved
   *   completed → approved
   *   rejected  → rejected + cancelled
   * tab takes precedence over status if both are provided.
   */
  @Get()
  @Roles(UserRole.ADMIN)
  findAll(
    @Query('status') status?: RequestStatus,
    @Query('tab') tab?: string,
  ) {
    return this.tokenRequestsService.findAll(status, tab);
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
   * GET /token-requests/:id/attachment
   * Returns a pre-signed S3 download URL (15-minute expiry) for the request's attachment.
   * Use this to render a download link — do NOT link directly to attachmentUrl (bucket is private).
   */
  @Get(':id/attachment')
  async getAttachmentDownloadUrl(@Param('id', ParseUUIDPipe) id: string) {
    const request = await this.tokenRequestsService.findOne(id);
    if (!request.attachmentUrl) {
      throw new BadRequestException('This request has no attachment');
    }
    // Extract the S3 key from the stored full URL.
    // decodeURIComponent is required because fileUrl stores the key with
    // percent-encoded segments (e.g. spaces → %20, parens → %28%29).
    // Without decoding, the key passed to S3 won't match the object that was uploaded.
    const key = decodeURIComponent(new URL(request.attachmentUrl).pathname.substring(1));
    const url = await this.s3Service.getPresignedDownloadUrl(key);
    return { url };
  }

  /**
   * PATCH /token-requests/:id/manager-approve
   * Manager approves a pending task-offloading or learning-subsidy request.
   * Coach approves a pending coaching request (they are stored as managerId).
   */
  @Patch(':id/manager-approve')
  @Roles(UserRole.APPROVER, UserRole.COACH, UserRole.ADMIN)
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
   * Manager rejects a pending task-offloading or learning-subsidy request.
   * Coach rejects a pending coaching request.
   */
  @Patch(':id/manager-reject')
  @Roles(UserRole.APPROVER, UserRole.COACH, UserRole.ADMIN)
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
   * PATCH /token-requests/:id/sessions/:sessionId/confirm
   * Coach confirms a pending booking request → status becomes scheduled.
   */
  @Patch(':id/sessions/:sessionId/confirm')
  @Roles(UserRole.COACH, UserRole.ADMIN)
  confirmSession(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: User,
  ) {
    return this.coachingSessionsService.confirmSession(id, sessionId, user.id);
  }

  /**
   * PATCH /token-requests/:id/sessions/:sessionId/decline
   * Coach declines a pending booking request. Releases the availability slot.
   */
  @Patch(':id/sessions/:sessionId/decline')
  @Roles(UserRole.COACH, UserRole.ADMIN)
  declineSession(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: User,
  ) {
    return this.coachingSessionsService.declineSession(id, sessionId, user.id);
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
   * Withdraw a not-yet-confirmed booking. Releases the availability slot.
   * Either the employee or the coach can do this unilaterally — for an
   * already-confirmed (scheduled) session, use request-cancel instead.
   */
  @Delete(':id/sessions/:sessionId')
  cancelSession(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: User,
  ) {
    return this.coachingSessionsService.cancelSession(id, sessionId, user.id);
  }

  /**
   * PATCH /token-requests/:id/sessions/:sessionId/request-cancel
   * Either party requests to cancel a confirmed (scheduled) session. Doesn't
   * cancel immediately — the other party must approve or decline it.
   * Body: { reason?: string }
   */
  @Patch(':id/sessions/:sessionId/request-cancel')
  requestCancelSession(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: User,
    @Body() dto: RequestCancelSessionDto,
  ) {
    return this.coachingSessionsService.requestCancelSession(id, sessionId, user.id, dto);
  }

  /**
   * PATCH /token-requests/:id/sessions/:sessionId/approve-cancel
   * The party who did NOT request cancellation approves it — finalizes to cancelled.
   */
  @Patch(':id/sessions/:sessionId/approve-cancel')
  approveCancelSession(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: User,
  ) {
    return this.coachingSessionsService.approveCancelSession(id, sessionId, user.id);
  }

  /**
   * PATCH /token-requests/:id/sessions/:sessionId/decline-cancel
   * Decline a pending cancellation request (or withdraw one you made yourself)
   * — reverts the session back to scheduled.
   */
  @Patch(':id/sessions/:sessionId/decline-cancel')
  declineCancelSession(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: User,
  ) {
    return this.coachingSessionsService.declineCancelSession(id, sessionId, user.id);
  }
}
