import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { PostType } from '../../common/enums';

export enum FeedScope {
  ALL = 'all',
  HOME = 'home',
}

export enum FeedSort {
  RECENT = 'recent',
  POPULAR = 'popular',
}

/** Query params for GET /community (docs/community.md §5). */
export class FeedQueryDto {
  @IsOptional()
  @IsEnum(FeedScope)
  scope: FeedScope = FeedScope.ALL;

  @IsOptional()
  @IsString()
  communityId?: string;

  /** Post type filter, or 'all'. */
  @IsOptional()
  @IsString()
  type?: PostType | 'all';

  @IsOptional()
  @IsEnum(FeedSort)
  sort: FeedSort = FeedSort.RECENT;

  @IsOptional()
  @IsString()
  topic?: string;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;
}
