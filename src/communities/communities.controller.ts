import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Delete,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CommunitiesService } from './communities.service';
import { InviteMembersDto } from './dto/invite-members.dto';
import type { CommunityFilter } from './communities.service';
import { CreateCommunityDto } from './dto/create-community.dto';
import { UpdateCommunityDto } from './dto/update-community.dto';
import { ReplaceResourcesDto } from './dto/community-resource.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../entities/user.entity';

@Controller('communities')
export class CommunitiesController {
  constructor(private readonly communitiesService: CommunitiesService) {}

  /** GET /communities — directory. */
  @Get()
  list(
    @CurrentUser() user: User,
    @Query('filter') filter: CommunityFilter = 'all',
    @Query('q') q?: string,
  ) {
    return this.communitiesService.list(user, filter, q);
  }

  /**
   * POST /communities — create a community.
   * Any authenticated user may create a *private* community; only platform
   * admins may create public ones. Enforced in the service.
   */
  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateCommunityDto) {
    return this.communitiesService.create(user, dto);
  }

  /** GET /communities/:id */
  @Get(':id')
  getOne(@CurrentUser() user: User, @Param('id') id: string) {
    return this.communitiesService.getOne(user, id);
  }

  /** PATCH /communities/:id — edit metadata (community admin or platform admin). */
  @Patch(':id')
  update(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: UpdateCommunityDto,
  ) {
    return this.communitiesService.update(user, id, dto);
  }

  /** PUT /communities/:id/resources — replace the resource list (admin). */
  @Put(':id/resources')
  replaceResources(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: ReplaceResourcesDto,
  ) {
    return this.communitiesService.replaceResources(user, id, dto);
  }

  /** POST /communities/:id/members/:userId/role — promote/demote a member (admin). */
  @Post(':id/members/:userId/role')
  @HttpCode(HttpStatus.OK)
  updateMemberRole(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.communitiesService.updateMemberRole(user, id, userId, dto.role);
  }

  /** POST /communities/:id/members/:userId/expert — toggle a member's expert flag (admin). */
  @Post(':id/members/:userId/expert')
  @HttpCode(HttpStatus.OK)
  toggleMemberExpert(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.communitiesService.toggleMemberExpert(user, id, userId);
  }

  /** POST /communities/:id/join */
  @Post(':id/join')
  @HttpCode(HttpStatus.OK)
  join(@CurrentUser() user: User, @Param('id') id: string) {
    return this.communitiesService.join(user, id);
  }

  /** POST /communities/:id/leave */
  @Post(':id/leave')
  @HttpCode(HttpStatus.OK)
  leave(@CurrentUser() user: User, @Param('id') id: string) {
    return this.communitiesService.leave(user, id);
  }

  /** DELETE /communities/:id/request — cancel a pending join request. */
  @Delete(':id/request')
  @HttpCode(HttpStatus.OK)
  cancelRequest(@CurrentUser() user: User, @Param('id') id: string) {
    return this.communitiesService.cancelRequest(user, id);
  }

  /** GET /communities/:id/members */
  @Get(':id/members')
  listMembers(@CurrentUser() user: User, @Param('id') id: string) {
    return this.communitiesService.listMembers(user, id);
  }

  /** GET /communities/:id/requests — admin only. */
  @Get(':id/requests')
  listRequests(@CurrentUser() user: User, @Param('id') id: string) {
    return this.communitiesService.listRequests(user, id);
  }

  /** POST /communities/:id/requests/:userId/approve — admin only. */
  @Post(':id/requests/:userId/approve')
  @HttpCode(HttpStatus.OK)
  approveRequest(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.communitiesService.approveRequest(user, id, userId);
  }

  /** POST /communities/:id/requests/:userId/decline — admin only. */
  @Post(':id/requests/:userId/decline')
  @HttpCode(HttpStatus.OK)
  declineRequest(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.communitiesService.declineRequest(user, id, userId);
  }

  // ─── Invitations ────────────────────────────────────────────────────────────

  /**
   * GET /communities/invitations/mine — the caller's pending invitations.
   *
   * Declared before any `:id` route: Nest matches in declaration order, so a
   * param route above this would swallow "invitations" as an id.
   */
  @Get('invitations/mine')
  listMyInvitations(@CurrentUser() user: User) {
    return this.communitiesService.listMyInvitations(user);
  }

  /** POST /communities/:id/invitations — admin only. Body: { userIds: string[] }. */
  @Post(':id/invitations')
  @HttpCode(HttpStatus.OK)
  invite(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: InviteMembersDto,
  ) {
    return this.communitiesService.invite(user, id, dto.userIds);
  }

  /** GET /communities/:id/invitations — admin only. */
  @Get(':id/invitations')
  listInvitations(@CurrentUser() user: User, @Param('id') id: string) {
    return this.communitiesService.listInvitations(user, id);
  }

  /** DELETE /communities/:id/invitations/:userId — admin withdraws an invitation. */
  @Delete(':id/invitations/:userId')
  revokeInvitation(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.communitiesService.revokeInvitation(user, id, userId);
  }

  /** POST /communities/:id/invitations/accept — the invitee joins. */
  @Post(':id/invitations/accept')
  @HttpCode(HttpStatus.OK)
  acceptInvitation(@CurrentUser() user: User, @Param('id') id: string) {
    return this.communitiesService.acceptInvitation(user, id);
  }

  /** POST /communities/:id/invitations/decline — the invitee says no. */
  @Post(':id/invitations/decline')
  @HttpCode(HttpStatus.OK)
  declineInvitation(@CurrentUser() user: User, @Param('id') id: string) {
    return this.communitiesService.declineInvitation(user, id);
  }
}
