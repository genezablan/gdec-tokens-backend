import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

const TIME_REGEX = /^\d{2}:\d{2}$/;

/** One coaching window on a single day of the week. */
export class CoachingWindowDto {
  /** Day of week this window applies to (0=Sun … 6=Sat). */
  @IsInt()
  @Min(0)
  @Max(6)
  day!: number;

  @Matches(TIME_REGEX, { message: 'startTime must be HH:MM' })
  startTime!: string;

  @Matches(TIME_REGEX, { message: 'endTime must be HH:MM' })
  endTime!: string;
}

/** Per-coach coaching availability. Each day can have several non-overlapping
 *  windows (e.g. 9–12 and 1–5); Outlook busy times are subtracted from these
 *  windows to produce bookable slots. */
export class UpdateCoachingHoursDto {
  /** Days not listed are not offered. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(28)
  @ValidateNested({ each: true })
  @Type(() => CoachingWindowDto)
  coachingWeeklyHours?: CoachingWindowDto[];

  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(480)
  coachingSessionMinutes?: number;
}
