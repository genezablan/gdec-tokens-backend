import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TokenRequest } from '../entities/token-request.entity';
import { User } from '../entities/user.entity';
import { DevelopmentOption } from '../entities/development-option.entity';
import { CoachingSession } from '../entities/coaching-session.entity';
import { CoachAvailability } from '../entities/coach-availability.entity';
import { TokenRequestsService } from './token-requests.service';
import { CoachingSessionsService } from './coaching-sessions.service';
import { TokenRequestsController } from './token-requests.controller';
import { TokenBalancesModule } from '../token-balances/token-balances.module';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TokenRequest, User, DevelopmentOption, CoachingSession, CoachAvailability]),
    TokenBalancesModule,
    CommonModule, // provides S3Service
  ],
  controllers: [TokenRequestsController],
  providers: [TokenRequestsService, CoachingSessionsService],
  exports: [TokenRequestsService, CoachingSessionsService],
})
export class TokenRequestsModule {}
