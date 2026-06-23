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

  /** GET /announcements — all authenticated users. */
  @Get()
  findAll() {
    return this.announcementsService.findAll();
  }

  /** GET /announcements/:id */
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.announcementsService.findOne(id);
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
