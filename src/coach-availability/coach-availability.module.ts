import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoachAvailability } from '../entities/coach-availability.entity';
import { CoachingSession } from '../entities/coaching-session.entity';
import { User } from '../entities/user.entity';
import { CoachAvailabilityService } from './coach-availability.service';
import { CoachAvailabilityController } from './coach-availability.controller';
import { CalendarModule } from '../calendar/calendar.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CoachAvailability, CoachingSession, User]),
    CalendarModule,
  ],
  controllers: [CoachAvailabilityController],
  providers: [CoachAvailabilityService],
  exports: [CoachAvailabilityService],
})
export class CoachAvailabilityModule {}
