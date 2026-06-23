import { IsEnum } from 'class-validator';
import { PostStatus } from '../../common/enums';

/** Body for PATCH /community/:id/status — admin sets the moderation status. */
export class UpdatePostStatusDto {
  @IsEnum(PostStatus)
  status: PostStatus;
}
