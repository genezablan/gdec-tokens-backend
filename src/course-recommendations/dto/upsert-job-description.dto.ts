import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpsertJobDescriptionDto {
  /** Must match `users.position` exactly for employees to see the results. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  position: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  content: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  source?: string;
}
