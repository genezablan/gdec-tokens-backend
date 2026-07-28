import {
  IsDateString,
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
 * Mirrors the "Development Token Request Form – Task Offloading" document.
 * The form is filled in-app; there is no document upload requirement.
 */
export class TaskOffloadingFormDataDto {
  /** Project title (OTJ / Special Project). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  projectTitle!: string;

  /** Offloading start date (ISO `YYYY-MM-DD`). Duration must be 1–3 months. */
  @IsDateString()
  startDate!: string;

  /** Offloading end date (ISO `YYYY-MM-DD`). */
  @IsDateString()
  endDate!: string;

  /** What the project is about. */
  @IsString()
  @IsNotEmpty()
  projectDescription!: string;

  /** Scope of work. */
  @IsString()
  @IsNotEmpty()
  scopeOfWork!: string;

  /** Success metrics / KPIs (optional on the form). */
  @IsOptional()
  @IsString()
  successMetrics?: string;

  /** Expected deliverables. */
  @IsString()
  @IsNotEmpty()
  expectedDeliverables!: string;

  /** How the project aligns with Department or GDEC priorities. */
  @IsString()
  @IsNotEmpty()
  businessAlignment!: string;

  /**
   * How the project supports the employee's development goals.
   * Optional on the form, but flagged as highly recommended.
   */
  @IsOptional()
  @IsString()
  developmentGoals?: string;

  /** Which task will be offloaded. */
  @IsString()
  @IsNotEmpty()
  taskToOffload!: string;

  /** Name of the colleague taking over the task (optional). */
  @IsOptional()
  @IsString()
  @MaxLength(150)
  colleagueName?: string;
}

export class CreateTaskOffloadingRequestDto {
  @IsNotEmpty()
  @IsUUID()
  developmentOptionId!: string;

  /** Optional S3 URL of a supporting document uploaded before submission. */
  @IsOptional()
  @IsString()
  attachmentUrl?: string;

  /** Form fields captured in the request modal; persisted as the request's formData. */
  @IsObject()
  @ValidateNested()
  @Type(() => TaskOffloadingFormDataDto)
  formData!: TaskOffloadingFormDataDto;
}
