import {
  Equals,
  IsBoolean,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Mirrors the "Development Token Request Form – Coaching" document.
 * The form is filled in-app; there is no document upload requirement.
 */
export class CoachingFormDataDto {
  /** Coaching focus area (e.g. leadership, communication). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  focusArea!: string;

  /** Development objective for the coaching cycle. */
  @IsString()
  @IsNotEmpty()
  developmentObjective!: string;

  /** Key challenges (optional on the form). */
  @IsOptional()
  @IsString()
  keyChallenges?: string;

  /** Expected outcomes after 3 sessions (optional on the form). */
  @IsOptional()
  @IsString()
  expectedOutcomes?: string;

  /** Free-text preferred schedule for the coaching sessions. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  preferredSchedule!: string;

  /** Acknowledgment that all sessions must be with the same coach. */
  @IsBoolean()
  @Equals(true, {
    message: 'You must acknowledge that all sessions are with the same coach',
  })
  sameCoachAcknowledged!: boolean;
}

export class CreateCoachingRequestDto {
  @IsNotEmpty()
  @IsUUID()
  developmentOptionId!: string;

  /** UUID of the employee with the coach role. */
  @IsNotEmpty()
  @IsUUID()
  coachId!: string;

  /** Optional notes or goals for the coaching cycle (legacy — superseded by formData.developmentObjective). */
  @IsOptional()
  @IsString()
  notes?: string;

  /** Optional S3 URL of a supporting document uploaded before submission. */
  @IsOptional()
  @IsString()
  attachmentUrl?: string;

  /** Form fields captured in the request modal; merged into the request's formData. */
  @IsObject()
  @ValidateNested()
  @Type(() => CoachingFormDataDto)
  formData!: CoachingFormDataDto;
}
