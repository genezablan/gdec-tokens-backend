import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class CreateTaskOffloadingRequestDto {
  @IsNotEmpty()
  @IsUUID()
  developmentOptionId!: string;

  /** S3 URL of the completed Task Offloading form, uploaded before submission. */
  @IsNotEmpty()
  @IsString()
  attachmentUrl!: string;
}
