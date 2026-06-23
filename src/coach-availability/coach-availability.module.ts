import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoachAvailability } from '../entities/coach-availability.entity';
import { CoachAvailabilityService } from './coach-availability.service';
import { CoachAvailabilityController } from './coach-availability.controller';
import { CalendarModule } from '../calendar/calendar.module';

@Module({
  imports: [TypeOrmModule.forFeature([CoachAvailability]), CalendarModule],
  controllers: [CoachAvailabilityController],
  providers: [CoachAvailabilityService],
  exports: [CoachAvailabilityService],
})
export class CoachAvailabilityModule {}
