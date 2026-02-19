import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

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
}
