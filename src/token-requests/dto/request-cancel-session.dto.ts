import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Body for requesting to cancel a scheduled session (mutual-consent flow). */
export class RequestCancelSessionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
