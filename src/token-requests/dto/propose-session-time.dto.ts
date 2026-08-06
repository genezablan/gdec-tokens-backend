import { IsOptional, IsString, MaxLength } from 'class-validator';
import { BookSessionDto } from './book-session.dto';

/**
 * Coach counter-proposes a (new) time for a session. Time is given the same
 * way as booking: an existing availability slot OR availableDate/startTime/endTime.
 */
export class ProposeSessionTimeDto extends BookSessionDto {
  /** Optional note from the coach explaining the proposal. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
