import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Body,
  ParseUUIDPipe,
  BadRequestException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { Roles } from '../auth/decorators/roles.decorator';
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
  findAll(
    @Query('role') role?: string,
    @Query('isActive') isActive?: string,
  ) {
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
  getPendingRegistrations() {
    return this.usersService.findAll(undefined, undefined, true);
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
