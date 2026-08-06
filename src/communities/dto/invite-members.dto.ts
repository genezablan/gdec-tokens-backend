import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

/** Body for POST /communities/:id/invitations. */
export class InviteMembersDto {
  /**
   * Users to invite. Capped so one request cannot enqueue a notification per
   * employee — inviting the whole company is a mistake, not a use case.
   */
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  userIds!: string[];
}
