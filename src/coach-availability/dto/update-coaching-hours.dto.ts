import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  Matches,
  Max,
  Min,
} from 'class-validator';

/** Per-coach coaching availability window. Outlook busy times are subtracted
 *  from this window to produce bookable slots. */
export class UpdateCoachingHoursDto {
  /** Days of week the coach offers coaching (0=Sun … 6=Sat). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  coachingDays?: number[];

  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/, { message: 'coachingStartTime must be HH:MM' })
  coachingStartTime?: string;

  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/, { message: 'coachingEndTime must be HH:MM' })
  coachingEndTime?: string;

  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(480)
  coachingSessionMinutes?: number;
}
