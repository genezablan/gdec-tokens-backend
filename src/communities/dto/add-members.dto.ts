import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { CommunityRole } from '../../common/enums';

/** Body for POST /communities/:id/members. */
export class AddMembersDto {
  /**
   * People to add. Capped so one request cannot enqueue a notification per
   * employee — adding the whole company is a mistake, not a use case.
   */
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  userIds!: string[];

  /** Defaults to member; pass admin to add someone as a co-admin directly. */
  @IsOptional()
  @IsEnum(CommunityRole)
  role?: CommunityRole;
}
