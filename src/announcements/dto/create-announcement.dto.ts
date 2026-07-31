import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class AnnouncementAttachmentDto {
  @IsString()
  url: string;

  @IsOptional()
  @IsString()
  name?: string;
}

export class CreateAnnouncementDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  /** Plain-text body (used as a fallback / for previews & search). */
  @IsOptional()
  @IsString()
  body?: string;

  /** Rich HTML body (sanitized server-side). */
  @IsOptional()
  @IsString()
  bodyHtml?: string;

  /** Image attachments. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AnnouncementAttachmentDto)
  attachments?: AnnouncementAttachmentDto[];

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;

  /**
   * Grouping label — shown as a badge and used by the board's filter tabs.
   * Free-form so new categories don't need a migration.
   */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  category?: string;

  /** Ask every employee to explicitly confirm they've read this. */
  @IsOptional()
  @IsBoolean()
  requiresAcknowledgement?: boolean;
}
