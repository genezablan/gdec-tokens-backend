import {
  IsDateString,
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

export class LearningSubsidyFormDataDto {
  /** Course/training start date (ISO `YYYY-MM-DD`). */
  @IsDateString()
  startDate!: string;

  /** Course/training end date (ISO `YYYY-MM-DD`). */
  @IsDateString()
  endDate!: string;
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
