import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Post } from '../entities/post.entity';
import { Comment } from '../entities/comment.entity';
import { CommentReaction } from '../entities/comment-reaction.entity';
import { Reaction } from '../entities/reaction.entity';
import { PollOption } from '../entities/poll-option.entity';
import { PollVote } from '../entities/poll-vote.entity';
import { PostView } from '../entities/post-view.entity';
import { PostMention } from '../entities/post-mention.entity';
import { CommentMention } from '../entities/comment-mention.entity';
import { PostPraised } from '../entities/post-praised.entity';
import { PostAttachment } from '../entities/post-attachment.entity';
import { CommunityController } from './community.controller';
import { CommunityService } from './community.service';
import { PostMapper } from './post.mapper';
import { CommonModule } from '../common/common.module';
import { CommunitiesModule } from '../communities/communities.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Post,
      Comment,
      CommentReaction,
      Reaction,
      PollOption,
      PollVote,
      PostView,
      PostMention,
      CommentMention,
      PostPraised,
      PostAttachment,
    ]),
    CommonModule, // CommunitySanitizerService
    CommunitiesModule, // CommunityAccessService + community repos
  ],
  controllers: [CommunityController],
  providers: [CommunityService, PostMapper],
  exports: [CommunityService, PostMapper],
})
export class CommunityModule {}
