import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Announcement } from '../entities/announcement.entity';
import { AnnouncementRead } from '../entities/announcement-read.entity';
import { AnnouncementAcknowledgement } from '../entities/announcement-acknowledgement.entity';
import { User } from '../entities/user.entity';
import { AnnouncementsController } from './announcements.controller';
import { AnnouncementsService } from './announcements.service';
import { CommonModule } from '../common/common.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Announcement,
      AnnouncementRead,
      AnnouncementAcknowledgement,
      User,
    ]),
    CommonModule,
    NotificationsModule,
  ],
  controllers: [AnnouncementsController],
  providers: [AnnouncementsService],
  exports: [AnnouncementsService],
})
export class AnnouncementsModule {}
