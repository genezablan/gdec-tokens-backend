import {
  Equals,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  IsNumber,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/** Mode of training values shown on the form. */
export const TRAINING_MODES = ['F2F / Onsite', 'Online'] as const;

/** Reimbursement type values shown on the form. */
export const REIMBURSEMENT_TYPES = ['Reimbursable', 'Pre-paid'] as const;

/**
 * Mirrors the "Development Token Request Form – Learning Subsidy" document.
 * The form is filled in-app; there is no document upload requirement.
 */
export class LearningSubsidyFormDataDto {
  /** Course/training start date (ISO `YYYY-MM-DD`). */
  @IsDateString()
  startDate!: string;

  /** Course/training end date (ISO `YYYY-MM-DD`). */
  @IsDateString()
  endDate!: string;

  /** Mode of training. */
  @IsIn(TRAINING_MODES)
  modeOfTraining!: (typeof TRAINING_MODES)[number];

  /** Total cost of the training in PHP. The subsidy amount cannot exceed it. */
  @IsNumber()
  @Min(1)
  totalCost!: number;

  /** What the training covers. */
  @IsString()
  @IsNotEmpty()
  learningDescription!: string;

  /** How the training aligns with GDEC goals or personal development. */
  @IsString()
  @IsNotEmpty()
  businessAlignment!: string;

  /** How the learning will be applied. */
  @IsString()
  @IsNotEmpty()
  applicationPlan!: string;

  /** Whether the training occurs during work hours. */
  @IsBoolean()
  duringWorkHours!: boolean;

  /** Confirmation that only one participant per team attends per day. */
  @IsBoolean()
  @Equals(true, {
    message: 'You must confirm only one participant per team per day',
  })
  onePerTeamAcknowledged!: boolean;

  /** Reimbursement type. */
  @IsIn(REIMBURSEMENT_TYPES)
  reimbursementType!: (typeof REIMBURSEMENT_TYPES)[number];
}

export class CreateLearningSubsidyRequestDto {
  @IsNotEmpty()
  @IsUUID()
  developmentOptionId!: string;

  /**
   * Subsidy amount in PHP. Must be a multiple of 1,000, max ₱3,000.
   * System will calculate tokenCost = amount / 1000.
   */
  @IsNumber()
  @Min(1000)
  @Max(3000)
  subsidyAmount!: number;

  /** Name of the course or training program being applied for. */
  @IsString()
  @IsNotEmpty()
  courseName!: string;

  /** Training provider or institution offering the course. */
  @IsString()
  @IsNotEmpty()
  provider!: string;

  /** Optional S3 URL of a supporting document uploaded before submission. */
  @IsOptional()
  @IsString()
  attachmentUrl?: string;

  /** Form fields captured in the request modal; merged into the request's formData. */
  @IsObject()
  @ValidateNested()
  @Type(() => LearningSubsidyFormDataDto)
  formData!: LearningSubsidyFormDataDto;
}
