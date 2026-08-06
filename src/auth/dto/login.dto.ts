import {
  IsEmail,
  IsNotEmpty,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

/**
 * Minimum password length, enforced everywhere a password is set.
 * Every path that can create a password already meets it — registration, reset,
 * change-password, and the `TempPass123!` seed used by the import scripts — so
 * no existing account is shut out by it.
 *
 * Deliberately not enforced on sign-in: `POST /auth/login` authenticates through
 * LocalAuthGuard and answers a bad password with 401, rather than a 400 that
 * would advertise the policy and reject anyone whose password predated it.
 *
 * The frontend mirrors this in `src/constants/auth.js`; keep the two in sync.
 */
export const PASSWORD_MIN_LENGTH = 8;

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(PASSWORD_MIN_LENGTH)
  oldPassword: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(PASSWORD_MIN_LENGTH)
  newPassword: string;
}

export class ForgotPasswordDto {
  @IsNotEmpty()
  @IsEmail()
  email: string;
}

export class ResetPasswordDto {
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @IsNotEmpty()
  @IsString()
  token: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(PASSWORD_MIN_LENGTH)
  newPassword: string;
}

export class HeartbeatDto {
  @IsNotEmpty()
  @IsUUID()
  loginEventId: string;
}

export class OAuthCallbackDto {
  @IsNotEmpty()
  @IsString()
  code: string;

  @IsNotEmpty()
  @IsString()
  provider: 'microsoft' | 'google';
}

export class RegisterDto {
  @IsNotEmpty()
  @IsString()
  firstName: string;

  @IsNotEmpty()
  @IsString()
  lastName: string;

  @IsNotEmpty()
  @IsString()
  department: string;

  @IsNotEmpty()
  @IsString()
  immediateSupervisorId: string; // UUID of the reporting-to supervisor

  @IsNotEmpty()
  @IsString()
  contact: string; // Phone number

  @IsNotEmpty()
  @IsEmail()
  email: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  password: string;
}
