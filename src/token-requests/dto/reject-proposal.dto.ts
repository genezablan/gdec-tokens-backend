import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Body for the employee rejecting a coach's proposed session time. */
export class RejectProposalDto {
  /** Optional reason — relayed to the coach, not persisted. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
