import {
  Controller,
  Post,
  Get,
  Delete,
  Patch,
  Body,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { CoachAvailabilityService } from './coach-availability.service';
import { CreateAvailabilitySlotDto } from './dto/create-availability-slot.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { User } from '../entities/user.entity';
import { UserRole } from '../common/enums';

@Controller('coach-availability')
export class CoachAvailabilityController {
  constructor(private readonly service: CoachAvailabilityService) {}

  /**
   * POST /coach-availability
   * Coach adds a new available time slot.
   */
  @Post()
  @Roles(UserRole.COACH, UserRole.ADMIN)
  addSlot(@CurrentUser() user: User, @Body() dto: CreateAvailabilitySlotDto) {
    return this.service.addSlot(user.id, dto);
  }

  /**
   * GET /coach-availability/my
   * Coach views their own upcoming availability slots.
   */
  @Get('my')
  @Roles(UserRole.COACH, UserRole.ADMIN)
  getMySlots(@CurrentUser() user: User) {
    return this.service.findMySlots(user.id);
  }

  /**
   * GET /coach-availability/:coachId
   * Any authenticated user can view a coach's available (unbooked, active) slots.
   * Used by employees when viewing a coach's schedule.
   */
  @Get(':coachId')
  getAvailableForCoach(@Param('coachId', ParseUUIDPipe) coachId: string) {
    return this.service.findAvailableForCoach(coachId);
  }

  /**
   * DELETE /coach-availability/:id
   * Coach deletes one of their own slots (only if not yet booked).
   */
  @Delete(':id')
  @Roles(UserRole.COACH, UserRole.ADMIN)
  removeSlot(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return this.service.removeSlot(id, user.id);
  }

  /**
   * PATCH /coach-availability/:id/deactivate
   * Coach deactivates a slot without deleting it.
   */
  @Patch(':id/deactivate')
  @Roles(UserRole.COACH, UserRole.ADMIN)
  deactivateSlot(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return this.service.deactivateSlot(id, user.id);
  }

  /**
   * PATCH /coach-availability/:id/reactivate
   * Coach reactivates a previously deactivated slot.
   * Returns 400 if the slot is already active, in the past, or overlaps with another active slot.
   */
  @Patch(':id/reactivate')
  @Roles(UserRole.COACH, UserRole.ADMIN)
  reactivateSlot(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return this.service.reactivateSlot(id, user.id);
  }
}
