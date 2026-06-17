import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Matches,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CommunityPrivacy } from '../../common/enums';
import { ResourceInputDto } from './community-resource.dto';

/**
 * POST /communities — create a community (platform admin only).
 * docs/community.md §14 (community creation/management).
 */
export class CreateCommunityDto {
  /**
   * Optional human slug to use as the id (e.g. `cnb-team`). If omitted a UUID
   * is generated. Lowercase letters, numbers and hyphens only.
   */
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]+$/, {
    message: 'id must be lowercase letters, numbers and hyphens only',
  })
  @MaxLength(100)
  id?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  slug?: string;

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

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ResourceInputDto)
  resources?: ResourceInputDto[];
}
