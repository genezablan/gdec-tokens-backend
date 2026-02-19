import { IsDateString, IsNotEmpty, IsString, Matches } from 'class-validator';

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateAvailabilitySlotDto {
  /** Date in YYYY-MM-DD format, e.g. "2026-03-10" */
  @IsDateString()
  @IsNotEmpty()
  availableDate!: string;

  /** Start time in HH:MM (24-hour) format, e.g. "09:00" */
  @IsString()
  @IsNotEmpty()
  @Matches(TIME_REGEX, { message: 'startTime must be in HH:MM format (24-hour)' })
  startTime!: string;

  /** End time in HH:MM (24-hour) format, e.g. "10:00" */
  @IsString()
  @IsNotEmpty()
  @Matches(TIME_REGEX, { message: 'endTime must be in HH:MM format (24-hour)' })
  endTime!: string;
}
