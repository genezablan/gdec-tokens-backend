import { IsOptional, IsUUID, Matches } from 'class-validator';

/**
 * Book a session either against an existing availability slot (legacy) OR by an
 * Outlook-derived time slot (availableDate + startTime + endTime).
 */
export class BookSessionDto {
  /** UUID of a pre-existing coach_availability slot (legacy manual slots). */
  @IsOptional()
  @IsUUID()
  availabilityId?: string;

  /** Outlook-derived slot date, "YYYY-MM-DD". */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'availableDate must be YYYY-MM-DD' })
  availableDate?: string;

  /** Outlook-derived slot start, "HH:MM". */
  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/, { message: 'startTime must be HH:MM' })
  startTime?: string;

  /** Outlook-derived slot end, "HH:MM". */
  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/, { message: 'endTime must be HH:MM' })
  endTime?: string;
}
