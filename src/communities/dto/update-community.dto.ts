import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CommunityPrivacy } from '../../common/enums';

/**
 * PATCH /communities/:id — edit metadata (community admin or platform admin).
 * All fields optional; only provided fields are updated.
 */
export class UpdateCommunityDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  about?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(500)
  avatarUrl?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(500)
  coverUrl?: string;

  @IsOptional()
  @IsEnum(CommunityPrivacy)
  privacy?: CommunityPrivacy;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  topics?: string[];
}
