import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

/** Requests whose current approver should be re-notified. */
export class NudgeApproversDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  requestIds: string[];
}
