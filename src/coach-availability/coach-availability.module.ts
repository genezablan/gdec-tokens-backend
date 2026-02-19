import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoachAvailability } from '../entities/coach-availability.entity';
import { CoachAvailabilityService } from './coach-availability.service';
import { CoachAvailabilityController } from './coach-availability.controller';

@Module({
  imports: [TypeOrmModule.forFeature([CoachAvailability])],
  controllers: [CoachAvailabilityController],
  providers: [CoachAvailabilityService],
  exports: [CoachAvailabilityService],
})
export class CoachAvailabilityModule {}
