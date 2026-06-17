import { IsEnum } from 'class-validator';
import { CommunityRole } from '../../common/enums';

/** POST /communities/:id/members/:userId/role — promote/demote a member. */
export class UpdateMemberRoleDto {
  @IsEnum(CommunityRole)
  role: CommunityRole;
}
