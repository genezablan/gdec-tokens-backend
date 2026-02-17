import { UserRole } from '../../common/enums';

export interface JwtPayload {
  sub: string; // userId
  employeeId: string;
  email: string;
  roles: UserRole[];
  firstName: string;
  lastName: string;
  department: string;
  type?: 'access' | 'refresh';
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    employeeId: string;
    email: string;
    firstName: string;
    lastName: string;
    department: string;
    position: string;
    roles: UserRole[];
    isPasswordChanged: boolean;
  };
  requiresPasswordChange?: boolean;
}
