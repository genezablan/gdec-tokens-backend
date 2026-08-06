import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../entities/user.entity';
import { TokenBalance } from '../entities/token-balance.entity';
import { UserFollow } from '../entities/user-follow.entity';
import { Post } from '../entities/post.entity';
import { Community } from '../entities/community.entity';
import { CommunityMember } from '../entities/community-member.entity';
import { TokenRequest } from '../entities/token-request.entity';
import { CoachingSession } from '../entities/coaching-session.entity';
import { CoachAvailability } from '../entities/coach-availability.entity';
import { DevelopmentOption } from '../entities/development-option.entity';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      TokenBalance,
      UserFollow,
      Post,
      Community,
      CommunityMember,
      TokenRequest,
      CoachingSession,
      CoachAvailability,
      DevelopmentOption,
    ]),
    CommonModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
