import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { CommunityService } from './community.service';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { ReactDto, CreateCommentDto, VoteDto } from './dto/interaction.dto';
import { FeedQueryDto } from './dto/feed-query.dto';
import { ModerationQueryDto } from './dto/moderation-query.dto';
import { UpdatePostStatusDto } from './dto/update-post-status.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { User } from '../entities/user.entity';
import {
  PostType,
  ReactionType,
  PraiseBadge,
  ResourceType,
  UserRole,
} from '../common/enums';

@Controller('community')
export class CommunityController {
  constructor(private readonly communityService: CommunityService) {}

  /** GET /community — the feed. */
  @Get()
  getFeed(@CurrentUser() user: User, @Query() query: FeedQueryDto) {
    return this.communityService.getFeed(user, query);
  }

  /**
   * GET /community/meta — canonical enum lists (docs/community.md §9.3).
   * NOTE: Must be declared BEFORE GET :id to avoid route conflict.
   */
  @Get('meta')
  getMeta() {
    return {
      postTypes: Object.values(PostType),
      reactions: Object.values(ReactionType),
      badges: Object.values(PraiseBadge),
      resourceTypes: Object.values(ResourceType),
    };
  }

  /**
   * GET /community/moderation — admin post-approval queue (all communities,
   * optionally filtered by status). Declared BEFORE GET :id to avoid a conflict.
   */
  @Get('moderation')
  @Roles(UserRole.ADMIN)
  getModerationFeed(
    @CurrentUser() user: User,
    @Query() query: ModerationQueryDto,
  ) {
    return this.communityService.getModerationFeed(user, query);
  }

  /** GET /community/:id — a single post with all comments. */
  @Get(':id')
  getPost(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.communityService.getPost(user, id);
  }

  /** POST /community — create a post. */
  @Post()
  createPost(@CurrentUser() user: User, @Body() dto: CreatePostDto) {
    return this.communityService.createPost(user, dto);
  }

  /** PATCH /community/:id — edit a post (author only). */
  @Patch(':id')
  updatePost(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePostDto,
  ) {
    return this.communityService.updatePost(user, id, dto);
  }

  /** PATCH /community/:id/status — admin approves / rejects a post. */
  @Patch(':id/status')
  @Roles(UserRole.ADMIN)
  setPostStatus(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePostStatusDto,
  ) {
    return this.communityService.setPostStatus(user, id, dto.status);
  }

  /** DELETE /community/:id — delete a post (author or admin). */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  deletePost(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.communityService.deletePost(user, id);
  }

  /** POST /community/:id/react */
  @Post(':id/react')
  @HttpCode(HttpStatus.OK)
  react(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReactDto,
  ) {
    return this.communityService.react(user, id, dto);
  }

  /** POST /community/:id/comments */
  @Post(':id/comments')
  addComment(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.communityService.addComment(user, id, dto);
  }

  /** POST /community/:id/vote */
  @Post(':id/vote')
  @HttpCode(HttpStatus.OK)
  vote(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoteDto,
  ) {
    return this.communityService.vote(user, id, dto);
  }

  /** POST /community/:id/pin — toggle pinned (community admin only). */
  @Post(':id/pin')
  @HttpCode(HttpStatus.OK)
  togglePin(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.communityService.togglePin(user, id);
  }

  /** POST /community/:id/seen — record that the caller viewed the post. */
  @Post(':id/seen')
  @HttpCode(HttpStatus.OK)
  markSeen(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.communityService.markSeen(user, id);
  }
}
