import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsString,
  IsUrl,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ResourceType } from '../../common/enums';

export class ResourceInputDto {
  @IsEnum(ResourceType)
  type: ResourceType;

  @IsString()
  @MaxLength(150)
  label: string;

  @IsUrl({ require_tld: false })
  @MaxLength(1000)
  url: string;
}

/** PUT /communities/:id/resources — replace the full resource list. */
export class ReplaceResourcesDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ResourceInputDto)
  resources: ResourceInputDto[];
}
