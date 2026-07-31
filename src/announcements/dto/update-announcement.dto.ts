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
import { AnnouncementAttachmentDto } from './create-announcement.dto';

export class UpdateAnnouncementDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
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
