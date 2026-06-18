import {
  IsDateString,
  IsNotEmpty,
  IsObject,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class TaskOffloadingFormDataDto {
  /** Short title for the request, e.g. "Task offloading request". */
  @IsString()
  @IsNotEmpty()
  requestSubject!: string;

  /** Offloading start date (ISO `YYYY-MM-DD`). */
  @IsDateString()
  startDate!: string;

  /** Offloading end date (ISO `YYYY-MM-DD`). */
  @IsDateString()
  endDate!: string;

  /** Why the offloading is needed. */
  @IsString()
  @IsNotEmpty()
  reason!: string;
}

export class CreateTaskOffloadingRequestDto {
  @IsNotEmpty()
  @IsUUID()
  developmentOptionId!: string;

  /** S3 URL of the completed Task Offloading form, uploaded before submission. */
  @IsNotEmpty()
  @IsString()
  attachmentUrl!: string;

  /** Form fields captured in the request modal; persisted as the request's formData. */
  @IsObject()
  @ValidateNested()
  @Type(() => TaskOffloadingFormDataDto)
  formData!: TaskOffloadingFormDataDto;
}
