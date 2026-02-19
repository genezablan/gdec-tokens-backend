import {
  IsNotEmpty,
  IsUUID,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateTokenRequestDto {
  @IsNotEmpty()
  @IsUUID()
  developmentOptionId: string;

  /**
   * JSON payload with request-specific fields.
   *
   * task_offloading:  { projectName: string, projectDescription: string }
   * coaching:         { coachId: string }
   * learning_subsidy: { subsidyAmount: number }
   */
  @IsOptional()
  @IsObject()
  formData?: Record<string, unknown>;

  /** Optional S3 URL of a supporting document uploaded before submission. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  attachmentUrl?: string;
}
