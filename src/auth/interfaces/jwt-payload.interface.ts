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
  /** id of the LoginEvent row created for this session, used to send heartbeat pings. */
  loginEventId: string | null;
  user: {
    id: string;
    employeeId: string;
    email: string;
    firstName: string;
    lastName: string;
    department: string;
    position: string | null;
    roles: UserRole[];
    isPasswordChanged: boolean;
  };
  requiresPasswordChange?: boolean;
}
