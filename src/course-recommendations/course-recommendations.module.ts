import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobDescription } from '../entities/job-description.entity';
import { CourseRecommendation } from '../entities/course-recommendation.entity';
import { TokenRequest } from '../entities/token-request.entity';
import { CourseRecommendationsController } from './course-recommendations.controller';
import { CourseRecommendationsService } from './course-recommendations.service';
import { JobDescriptionsService } from './job-descriptions.service';
import { CourseGeneratorService } from './course-generator.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      JobDescription,
      CourseRecommendation,
      TokenRequest,
    ]),
  ],
  controllers: [CourseRecommendationsController],
  providers: [
    CourseRecommendationsService,
    JobDescriptionsService,
    CourseGeneratorService,
  ],
  exports: [CourseRecommendationsService],
})
export class CourseRecommendationsModule {}
