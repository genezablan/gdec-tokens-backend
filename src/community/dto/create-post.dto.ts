import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { AttachmentType, PostType, PraiseBadge } from '../../common/enums';

export class AttachmentInputDto {
  @IsEnum(AttachmentType)
  type: AttachmentType;

  @IsUrl({ require_tld: false })
  @MaxLength(1000)
  url: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;
}

/**
 * POST /community body (docs/community.md §5).
 * Type-conditional requirements are enforced in the service (§13) so we can
 * return precise messages; this DTO covers shape/format only.
 */
export class CreatePostDto {
  @IsEnum(PostType)
  type: PostType;

  @IsString()
  communityId: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsString()
  bodyHtml?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  topics?: string[];

  /** User IDs (server hydrates names/avatars). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mentions?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttachmentInputDto)
  attachments?: AttachmentInputDto[];

  // ─── Praise only ──────────────────────────────────────────────────────────

  @IsOptional()
  @IsEnum(PraiseBadge)
  badge?: PraiseBadge;

  /** Praise recipient user IDs. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  praisedPeople?: string[];

  // ─── Poll only ──────────────────────────────────────────────────────────
  // Array constraints apply ONLY to poll posts — other types may send an empty
  // `pollOptions: []`, which must not trip the min-size rule.

  @ValidateIf((o) => o.type === PostType.POLL)
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  pollOptions?: string[];
}
