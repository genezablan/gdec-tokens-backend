import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Body for the employee asking the coach to propose a different time. */
export class RequestNewTimeDto {
  /** Optional note for the coach (e.g. "afternoons don't work for me"). */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
