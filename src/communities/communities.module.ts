import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Community } from '../entities/community.entity';
import { CommunityMember } from '../entities/community-member.entity';
import { CommunityRequest } from '../entities/community-request.entity';
import { CommunityResource } from '../entities/community-resource.entity';
import { Post } from '../entities/post.entity';
import { CommunitiesController } from './communities.controller';
import { CommunitiesService } from './communities.service';
import { CommunityAccessService } from './community-access.service';
import { CommunityMapper } from './community.mapper';
import { CommunityNotifier } from './community-notifier.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Community,
      CommunityMember,
      CommunityRequest,
      CommunityResource,
      Post,
    ]),
    NotificationsModule,
  ],
  controllers: [CommunitiesController],
  providers: [
    CommunitiesService,
    CommunityAccessService,
    CommunityMapper,
    CommunityNotifier,
  ],
  // Exported so the community feed module can reuse visibility/RBAC + mapping + notifier.
  exports: [
    CommunityAccessService,
    CommunityMapper,
    CommunityNotifier,
    TypeOrmModule,
  ],
})
export class CommunitiesModule {}
