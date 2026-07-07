import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  BadRequestException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../entities/user.entity';
import { UserRole } from '../common/enums';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * GET /users
   * List users with optional filters.
   *
   * ?role=coach|employee|approver|hr_approver|admin  → users who have that role
   * ?isActive=true|false                             → filter by active status
   *
   * Common usages:
   *   GET /users?role=coach&isActive=true  → list active coaches for coaching request form
   *   GET /users                           → all users (admin)
   *
   * Auth: any authenticated user (for role=coach lookup); admin-only for full list
   */
  @Get()
  findAll(@Query('role') role?: string, @Query('isActive') isActive?: string) {
    const roleEnum = role ? (role as UserRole) : undefined;
    if (role && !Object.values(UserRole).includes(role as UserRole)) {
      throw new BadRequestException(`Invalid role: ${role}`);
    }

    const activeFilter =
      isActive === 'true' ? true : isActive === 'false' ? false : undefined;

    return this.usersService.findAll(roleEnum, activeFilter);
  }

  /**
   * GET /users/pending-registrations
   * List all accounts with isPendingApproval = true.
   * Auth: hr_approver or admin.
   * NOTE: Must be declared BEFORE GET :id to avoid route conflict.
   */
  @Get('pending-registrations')
  @Roles(UserRole.HR_APPROVER, UserRole.ADMIN)
  async getPendingRegistrations() {
    const users = await this.usersService.findAll(undefined, undefined, true);
    const currentYear = new Date().getFullYear();
    // Attach tokensToBeAllocated so the approval page can display it
    return users.map((u) => ({
      ...u,
      tokensToBeAllocated: 6,
      tokenYear: currentYear,
    }));
  }

  /**
   * GET /users/search?q=
   * People-picker for the Community composer (@mentions / praise).
   * Returns up to 8 UserBrief { id, name, avatarUrl }.
   * NOTE: Must be declared BEFORE GET :id to avoid route conflict.
   */
  @Get('search')
  searchUsers(@Query('q') q?: string) {
    return this.usersService.searchBriefs(q);
  }

  /**
   * GET /users/:id
   * Get a single user by UUID.
   * Auth: any authenticated user.
   */
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findOne(id);
  }

  /**
   * GET /users/:id/profile — public profile + per-viewer follow state.
   * Auth: any authenticated user.
   */
  @Get(':id/profile')
  getProfile(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.usersService.getProfile(user.id, id);
  }

  /**
   * POST /users/:id/follow — toggle the caller's follow of the target user.
   * Auth: any authenticated user.
   */
  @Post(':id/follow')
  @HttpCode(HttpStatus.OK)
  toggleFollow(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.usersService.toggleFollow(user.id, id);
  }

  /**
   * PATCH /users/:id
   * HR/admin edit of a user's profile (manager, department, position, employee type).
   * `immediateSupervisorId: null` clears the manager; a UUID must belong to an
   * active user with the approver role. In-flight token requests keep the
   * approver resolved at submission time; only new requests route to the new manager.
   * Auth: hr_approver or admin.
   */
  @Patch(':id')
  @Roles(UserRole.HR_APPROVER, UserRole.ADMIN)
  updateUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.updateUser(id, dto);
  }

  /**
   * PATCH /users/:id/roles
   * Update the roles array for a user.
   * Body: { roles: UserRole[] }
   * Auth: admin only.
   */
  @Patch(':id/roles')
  @Roles(UserRole.ADMIN)
  updateRoles(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('roles') roles: UserRole[],
  ) {
    if (!Array.isArray(roles) || roles.length === 0) {
      throw new BadRequestException('roles must be a non-empty array');
    }
    return this.usersService.updateRoles(id, roles);
  }

  /**
   * PATCH /users/:id/toggle-active
   * Toggle isActive for a user (activate / deactivate).
   * Auth: admin only.
   */
  @Patch(':id/toggle-active')
  @Roles(UserRole.ADMIN)
  toggleActive(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.toggleActive(id);
  }

  /**
   * PATCH /users/:id/approve-registration
   * HR approves a pending registration → isActive = true.
   * Auth: hr_approver or admin.
   */
  @Patch(':id/approve-registration')
  @Roles(UserRole.HR_APPROVER, UserRole.ADMIN)
  approveRegistration(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.approvePendingRegistration(id);
  }

  /**
   * PATCH /users/:id/reject-registration
   * HR rejects a pending registration — account stays inactive.
   * Body: { reason?: string }
   * Auth: hr_approver or admin.
   */
  @Patch(':id/reject-registration')
  @Roles(UserRole.HR_APPROVER, UserRole.ADMIN)
  rejectRegistration(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('reason') reason?: string,
  ) {
    return this.usersService.rejectPendingRegistration(id, reason);
  }
}
