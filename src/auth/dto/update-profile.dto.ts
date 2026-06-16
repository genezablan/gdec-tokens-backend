import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  nickname?: string;

  /**
   * S3 key returned by GET /auth/profile/presigned-upload after the browser
   * has successfully PUT the file directly to S3.
   */
  @IsOptional()
  @IsString()
  profilePictureKey?: string;

  // ─── Coach profile fields ─────────────────────────────────────────────────
  // Forwarded by the coach profile editor; persisted for users with the coach role.

  @IsOptional()
  @IsString()
  @MaxLength(120)
  headline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  specialties?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(80)
  yearsExperience?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  maxCoachesPerCycle?: number;
}
