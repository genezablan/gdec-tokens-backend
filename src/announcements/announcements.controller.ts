import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { AnnouncementsService } from './announcements.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { User } from '../entities/user.entity';
import { UserRole } from '../common/enums';

/** Only Admin and HR may author announcements; everyone authenticated can read. */
const AUTHOR_ROLES = [UserRole.ADMIN, UserRole.HR_APPROVER];

@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly announcementsService: AnnouncementsService) {}

  /**
   * GET /announcements — all authenticated users. Each item carries the caller's
   * own read / acknowledged state, so the board can show what still needs them.
   */
  @Get()
  findAll(@CurrentUser() user: User) {
    return this.announcementsService.findAll(user.id);
  }

  /** GET /announcements/:id */
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.announcementsService.findOne(id, user.id);
  }

  /**
   * POST /announcements/:id/read — mark as read for the caller. Idempotent, and
   * fire-and-forget from the client's point of view.
   */
  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  markRead(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.announcementsService.markRead(id, user.id);
  }

  /**
   * POST /announcements/:id/acknowledge — record the caller's explicit
   * acknowledgement. 400 if the announcement never asked for one.
   */
  @Post(':id/acknowledge')
  @HttpCode(HttpStatus.OK)
  acknowledge(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return this.announcementsService.acknowledge(id, user.id);
  }

  /** POST /announcements — Admin / HR only. */
  @Post()
  @Roles(...AUTHOR_ROLES)
  create(@CurrentUser() user: User, @Body() dto: CreateAnnouncementDto) {
    return this.announcementsService.create(user, dto);
  }

  /** PATCH /announcements/:id — Admin / HR only. */
  @Patch(':id')
  @Roles(...AUTHOR_ROLES)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAnnouncementDto,
  ) {
    return this.announcementsService.update(id, dto);
  }

  /** DELETE /announcements/:id — Admin / HR only. */
  @Delete(':id')
  @Roles(...AUTHOR_ROLES)
  @HttpCode(HttpStatus.OK)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.announcementsService.remove(id);
  }
}
