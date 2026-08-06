import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { EmployeeType } from '../../common/enums';

/**
 * PATCH /users/:id — HR/admin edit of another user's profile.
 * All fields optional; only provided fields are updated.
 * `immediateSupervisorId: null` explicitly clears the manager.
 */
export class UpdateUserDto {
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  immediateSupervisorId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  department?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(100)
  position?: string | null;

  @IsOptional()
  @IsEnum(EmployeeType)
  employeeType?: EmployeeType;
}
