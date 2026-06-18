import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PraiseBadge } from '../../common/enums';
import { AttachmentInputDto } from './create-post.dto';

/**
 * PATCH /community/:id body. Editing is author-only and cannot change a post's
 * type, community, or (for polls) options/votes. Any provided field replaces the
 * stored value; omitted fields are left unchanged. Attachments/mentions, when
 * provided, replace the existing set wholesale.
 */
export class UpdatePostDto {
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

  /** User IDs (server hydrates names/avatars). Replaces the existing mentions. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mentions?: string[];

  /** Replaces the existing attachment set. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttachmentInputDto)
  attachments?: AttachmentInputDto[];

  // ─── Praise only ──────────────────────────────────────────────────────────

  @IsOptional()
  @IsEnum(PraiseBadge)
  badge?: PraiseBadge;

  /** Praise recipient user IDs. Replaces the existing set. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  praisedPeople?: string[];
}
