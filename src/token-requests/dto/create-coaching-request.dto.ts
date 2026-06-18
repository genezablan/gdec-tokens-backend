import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CoachingFormDataDto {
  /** Free-text preferred schedule for the coaching sessions. */
  @IsString()
  @IsNotEmpty()
  preferredSchedule!: string;
}

export class CreateCoachingRequestDto {
  @IsNotEmpty()
  @IsUUID()
  developmentOptionId!: string;

  /** UUID of the employee with the coach role. */
  @IsNotEmpty()
  @IsUUID()
  coachId!: string;

  /** Optional notes or goals for the coaching cycle. */
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
