import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  employeeId?: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(6)
  password: string;
}

export class ChangePasswordDto {
  @IsNotEmpty()
  @IsString()
  @MinLength(8)
  newPassword: string;

  @IsOptional()
  @IsString()
  currentPassword?: string;
}

export class OAuthCallbackDto {
  @IsNotEmpty()
  @IsString()
  code: string;

  @IsNotEmpty()
  @IsString()
  provider: 'microsoft' | 'google';
}
