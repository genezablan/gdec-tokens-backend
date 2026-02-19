import { IsUUID, IsNotEmpty } from 'class-validator';

export class BookSessionDto {
  /** UUID of the coach_availability slot to book for this session. */
  @IsUUID()
  @IsNotEmpty()
  availabilityId!: string;
}
