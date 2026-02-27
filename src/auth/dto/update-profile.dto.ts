import { IsOptional, IsString, MaxLength } from 'class-validator';

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
}
