import { IsNotEmpty, IsOptional, IsString, Max, Min, IsNumber, IsUUID } from 'class-validator';

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
}
