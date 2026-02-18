# 🔐 Frontend Implementation Guide: Authentication Module

## 📋 Project Brief

Implement a comprehensive **Authentication System** for the GDEC Tokens management frontend. This module provides secure JWT-based authentication with local login (email and password), password management, role-based access control, and token refresh capabilities.

---

## 🎯 Backend API Endpoints Available

**Base URL:** `http://localhost:3000/api/auth`

| Method  | Endpoint                | Purpose                                  | Auth Required |
| ------- | ----------------------- | ---------------------------------------- | ------------- |
| `POST`  | `/auth/login`           | Login with email/employeeId and password | No            |
| `GET`   | `/auth/me`              | Get current user basic info              | Yes           |
| `GET`   | `/auth/profile`         | Get user profile with supervisor details | Yes           |
| `PATCH` | `/auth/change-password` | Change password (first-time/update)      | Yes           |
| `POST`  | `/auth/refresh`         | Refresh access token using refresh token | No            |

---

Important notes:

- All employees start with default password: `TempPass123!`
- First-time users must change password on initial login (tracked via `isPasswordChanged` flag)
- Login with email only
- Access tokens expire in 7 days, refresh tokens in 7 days
- JWT tokens required in Authorization header: `Bearer <token>`
- Role-based access control: `employee`, `coach`, `approver`, `admin`

## 📝 Data Model Reference

### User Entity Structure:

```typescript
{
  id: number;                    // Auto-generated primary key
  employeeId: string;           // Unique employee ID (format: YYYYMM-XX)
  email: string;                // User email (unique)
  password: string;             // Bcrypt hashed password
  firstName: string;            // Employee first name
  middleName?: string;          // Employee middle name
  lastName: string;             // Employee last name
  suffix?: string;              // Name suffix (Jr, Sr, III)
  gender: Gender;               // Enum: Male, Female, Other
  employeeType: EmployeeType;   // Enum: Probationary, Regular, Consultant
  employeeStatus: EmployeeStatus; // Enum: Regular, Probationary, Resigned, AWOL, Terminated

  // Authentication & Authorization
  roles: UserRole[];            // Array of roles: employee, coach, approver, admin
  authProvider: AuthProvider;   // Enum: local, google, microsoft
  providerId?: string;          // OAuth provider user ID
  isActive: boolean;            // Account active status
  isPasswordChanged: boolean;   // Has changed default password
  lastLoginAt?: Date;           // Last login timestamp

  // Organizational
  immediateSupervisorId?: number; // FK to supervisor (self-referencing)
  immediateSupervisor?: User;   // Supervisor user object

  // Audit fields
  createdAt: Date;              // Creation timestamp
  updatedAt: Date;              // Last update timestamp
}
```

### Enums:

#### UserRole:

- `employee` - Standard employee access
- `coach` - Can provide coaching services
- `approver` - Can approve token requests
- `admin` - Full system access

#### Gender:

- `Male`
- `Female`
- `Other`

#### EmployeeType:

- `Probationary` - Probationary employee
- `Regular` - Regular employee
- `Consultant` - External consultant

#### EmployeeStatus:

- `Regular` - Active regular employee
- `Probationary` - On probation
- `Resigned` - Resigned from company
- `AWOL` - Absent without leave
- `Terminated` - Employment terminated

#### AuthProvider:

- `local` - Email/password authentication
- `google` - Google OAuth (prepared, not active)
- `microsoft` - Microsoft OAuth (prepared, not active)

### Authentication DTOs:

#### LoginDto:

```typescript
{
  email: string; // Email address
  password: string; // User password
}
```

#### ChangePasswordDto:

```typescript
{
  oldPassword: string; // Current password
  newPassword: string; // New password
}
```

#### AuthResponse:

```typescript
{
  accessToken: string;     // JWT access token (7d expiry)
  refreshToken: string;    // Refresh token (7d expiry)
  user: {
    sub: number;           // User ID
    email: string;         // User email
    employeeId: string;    // Employee ID
    roles: UserRole[];     // User roles
  };
}
```

#### UserProfileResponse:

```typescript
{
  id: number;
  employeeId: string;
  email: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  fullName: string;        // Computed: firstName + middleName + lastName + suffix
  roles: UserRole[];
  employeeType: EmployeeType;
  employeeStatus: EmployeeStatus;
  isActive: boolean;
  lastLoginAt?: Date;
  immediateSupervisor?: {
    id: number;
    employeeId: string;
    email: string;
    fullName: string;
  };
}
```

### JWT Payload Structure:

```typescript
{
  sub: number;              // User ID
  email: string;            // User email
  employeeId: string;       // Employee ID
  roles: UserRole[];        // User roles array
  iat: number;              // Issued at timestamp
  exp: number;              // Expiration timestamp
}
```

---

## 🔧 Test Commands for API Validation

### Login with Email:

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "gm.zablan@greatdealscorp.com",
    "password": "TempPass123!"
  }'
```

**Expected Response (200):**

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "sub": 1,
    "email": "gm.zablan@greatdealscorp.com",
    "employeeId": "202409-09",
    "roles": ["employee", "admin"]
  }
}
```

### Login with Employee ID:

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "202409-09",
    "password": "TempPass123!"
  }'
```

### Get Current User Info:

```bash
curl -X GET http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**Expected Response (200):**

```json
{
  "id": 1,
  "employeeId": "202409-09",
  "email": "gm.zablan@greatdealscorp.com",
  "firstName": "Gene Melchor",
  "lastName": "Zablan",
  "fullName": "Gene Melchor Zablan",
  "roles": ["employee", "admin"],
  "employeeType": "Regular",
  "employeeStatus": "Regular",
  "isActive": true
}
```

### Get User Profile with Supervisor:

```bash
curl -X GET http://localhost:3000/api/auth/profile \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**Expected Response (200):**

```json
{
  "id": 1,
  "employeeId": "202409-09",
  "email": "gm.zablan@greatdealscorp.com",
  "firstName": "Gene Melchor",
  "middleName": null,
  "lastName": "Zablan",
  "fullName": "Gene Melchor Zablan",
  "roles": ["employee", "admin"],
  "employeeType": "Regular",
  "employeeStatus": "Regular",
  "isActive": true,
  "lastLoginAt": "2026-02-17T08:30:00.000Z",
  "immediateSupervisor": {
    "id": 5,
    "employeeId": "202403-15",
    "email": "john.smith@greatdealscorp.com",
    "fullName": "John Smith"
  },
  "createdAt": "2026-01-15T10:00:00.000Z",
  "updatedAt": "2026-02-17T08:30:00.000Z"
}
```

### Change Password (First Time):

```bash
curl -X PATCH http://localhost:3000/api/auth/change-password \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{
    "oldPassword": "TempPass123!",
    "newPassword": "MyNewSecurePass456!"
  }'
```

**Expected Response (200):**

```json
{
  "message": "Password changed successfully. This is your first password change.",
  "isFirstPasswordChange": true
}
```

### Change Password (Subsequent):

```bash
curl -X PATCH http://localhost:3000/api/auth/change-password \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{
    "oldPassword": "MyNewSecurePass456!",
    "newPassword": "AnotherSecurePass789!"
  }'
```

**Expected Response (200):**

```json
{
  "message": "Password changed successfully",
  "isFirstPasswordChange": false
}
```

### Refresh Access Token:

```bash
curl -X POST http://localhost:3000/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }'
```

**Expected Response (200):**

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### Error Examples:

#### Invalid Credentials (401):

```json
{
  "message": "Invalid credentials",
  "error": "Unauthorized",
  "statusCode": 401
}
```

#### Inactive Account (401):

```json
{
  "message": "Account is not active",
  "error": "Unauthorized",
  "statusCode": 401
}
```

#### Invalid Old Password (400):

```json
{
  "message": "Current password is incorrect",
  "error": "Bad Request",
  "statusCode": 400
}
```

#### Unauthorized Access (401):

```json
{
  "message": "Unauthorized",
  "statusCode": 401
}
```

#### Insufficient Permissions (403):

```json
{
  "message": "Forbidden resource",
  "error": "Forbidden",
  "statusCode": 403
}
```

---

## 🎨 Frontend Requirements

### Core Features Needed:

1. **Login Interface**
   - Email input with validation
   - Password input with show/hide toggle
   - "Remember me" functionality
   - Clean, professional login design
   - Loading states during authentication
   - Clear error messages for invalid credentials
   - Forgot password link (future enhancement)
   - Company branding and theme

2. **First-Time Password Change Flow**
   - Automatic detection of first-time users (`isPasswordChanged: false`)
   - Mandatory password change before accessing system
   - Modal/page forcing password change
   - Password strength indicator
   - Confirmation password field
   - Password validation rules display
   - Success confirmation before proceeding

3. **Password Change Interface**
   - Current password verification
   - New password input with strength meter
   - Password confirmation field
   - Real-time validation feedback
   - Password requirements checklist
   - Success/error notifications
   - Accessibility support for screen readers

4. **Authentication State Management**
   - JWT token storage (secure localStorage)
   - Refresh token storage (HTTP-only cookies recommended)
   - Automatic token refresh before expiration
   - Login persistence across browser sessions
   - Secure logout with token cleanup
   - Auth state synchronization across tabs
   - Session timeout handling with warnings (1 day before expiry)

5. **Protected Route System**
   - Route guards for authenticated users only
   - Role-based route protection (employee/coach/approver/admin)
   - Automatic redirect to login for unauthenticated access
   - Redirect to last attempted route after login
   - Deep link preservation through login flow
   - Navigation menu based on user roles
   - Permission-based component rendering

6. **User Profile Display**
   - User information display (name, email, employee ID)
   - Role badges (employee, coach, approver, admin)
   - Employee type and status indicators
   - Last login timestamp
   - Supervisor information display
   - Account status indicators
   - Profile dropdown menu

7. **Security Features**
   - Token expiration handling with warnings
   - Automatic logout on token expiry (7 days)
   - Session timeout warnings (1 day before expiry)
   - Secure token storage practices
   - Password validation rules enforcement
   - Login attempt rate limiting (frontend)
   - Secure password input (no autocomplete for password fields)

8. **Role-Based Access Control**
   - Dynamic navigation menu based on roles
   - Component-level permission checks
   - Feature toggles based on user roles
   - Admin-only sections and features
   - Coach dashboard for coaching services
   - Approver workflow interface
   - Permission denied messages

### Advanced Features:

- **Session Management**: Multiple device login tracking
- **Security Dashboard**: Login analytics and session history
- **Audit Logging**: User action tracking and history
- **OAuth Integration**: Google and Microsoft login (prepared)
- **Two-Factor Authentication**: SMS/TOTP integration (future)
- **Password Reset**: Email-based password recovery
- **Account Locking**: After multiple failed login attempts
- **Security Notifications**: Email alerts for suspicious activity

### User Experience Goals:

- **Seamless Login**: Fast, intuitive login with email
- **Security Transparency**: Clear security status and requirements
- **Role Clarity**: Obvious permission and access levels
- **Mobile Optimization**: Touch-friendly authentication UI
- **Accessibility**: Screen reader and keyboard navigation support
- **Performance**: Fast authentication and route protection
- **Error Clarity**: Helpful error messages without exposing security details

### Security Best Practices:

- **Token Security**: Secure storage and transmission over HTTPS
- **Session Management**: Proper timeout and cleanup
- **Error Handling**: Security-conscious error messages (don't reveal if email exists)
- **Password Policy**: Strong password requirements enforcement
- **Rate Limiting**: Prevent brute force attempts
- **HTTPS Only**: All authentication in production over HTTPS
- **CORS Configuration**: Proper origin validation
- **XSS Prevention**: Sanitize user inputs

---

## 🚀 Implementation Steps

### Phase 1: Core Authentication (Week 1)

1. Create login page with email input
2. Implement password input with show/hide toggle
3. Build authentication API client with axios/fetch
4. Set up JWT token storage (localStorage + cookies)
5. Create authentication context/store (React Context/Redux/Zustand)
6. Build basic route protection (auth guard)
7. Implement logout functionality

### Phase 2: Password Management (Week 1-2)

1. Create password change modal/page
2. Detect first-time users and force password change
3. Build password strength indicator
4. Add password validation rules
5. Implement change password API integration
6. Add success/error notifications
7. Test password change workflow

### Phase 3: Token Management (Week 2)

1. Implement automatic token refresh logic
2. Add token expiration detection
3. Create session timeout warnings (5-min, 1-min)
4. Build automatic logout on expiry
5. Add token refresh error handling
6. Implement cross-tab auth synchronization
7. Test token lifecycle management

### Phase 4: User Profile & Roles (Week 2-3)

1. Create user profile display component
2. Build role badge components
3. Implement supervisor information display
4. Add role-based navigation menu
5. Create component-level permission checks
6. Build admin/coach/approver specific dashboards
7. Test role-based access control

### Phase 5: Security & UX (Week 3)

1. Add "Remember me" functionality
2. Implement login loading states
3. Create security notifications
4. Add session history display
5. Build security settings page
6. Implement mobile-responsive design
7. Add accessibility features (ARIA labels, keyboard nav)

### Phase 6: Advanced Features (Week 4)

1. Prepare OAuth integration (Google/Microsoft)
2. Add password reset flow preparation
3. Implement security audit logging
4. Create login analytics dashboard
5. Add account locking mechanism
6. Build security alerts system
7. Final testing and optimization

---

## 🎯 Success Criteria

### ✅ Must Have:

- ✅ Login with email
- ✅ Secure JWT token management (access + refresh)
- ✅ First-time password change enforcement
- ✅ Password change functionality
- ✅ Protected routes with role-based access
- ✅ User profile display with roles
- ✅ Automatic token refresh before expiry
- ✅ Secure logout with token cleanup
- ✅ Mobile-responsive authentication UI
- ✅ Proper error handling and validation
- ✅ Loading states and user feedback
- ✅ Security best practices implementation

### ✅ Should Have:

- ✅ Session timeout warnings
- ✅ Cross-tab auth synchronization
- ✅ Role-based navigation menu
- ✅ Supervisor information display
- ✅ Password strength indicator
- ✅ "Remember me" functionality
- ✅ Login attempt rate limiting
- ✅ Account status indicators
- ✅ Security notifications

### ✅ Nice to Have:

- 📋 OAuth integration (Google/Microsoft)
- 📋 Password reset via email
- 📋 Two-factor authentication
- 📋 Multi-device session management
- 📋 Security analytics dashboard
- 📋 Advanced audit trail visualization
- 📋 Account locking after failed attempts
- 📋 Security alerts and notifications
- 📋 Login history and analytics

---

## 💡 Key Considerations

### **JWT Token Management**

- **Storage Strategy**: Use `localStorage` for access tokens, secure HTTP-only cookies for refresh tokens in production
- **Expiration**: Access tokens expire in 7 days, refresh tokens in 7 days
- **Auto Refresh**: Implement refresh logic 1 day before access token expiry
- **Sync Across Tabs**: Use `localStorage` events or BroadcastChannel API
- **Cleanup**: Always clear tokens on logout and on 401 errors

### **Login Flow**

1. User enters email/employeeId and password
2. POST to `/auth/login`
3. Store access & refresh tokens
4. Check `isPasswordChanged` flag
5. If false → Force password change modal
6. If true → Redirect to dashboard
7. On subsequent visits, validate stored token
8. If expired, attempt refresh
9. If refresh fails, redirect to login

### **Password Change Flow**

1. User logs in with default password
2. Detect `isPasswordChanged: false`
3. Show password change modal (cannot dismiss)
4. Validate new password requirements
5. PATCH to `/auth/change-password`
6. Update token with new credentials
7. Show success message
8. Proceed to dashboard

### **Role-Based Access Control**

- **Employee**: Basic token management, view balance, submit requests
- **Coach**: All employee features + coaching service provisioning
- **Approver**: All employee features + token request approval
- **Admin**: All features + user management, system configuration

Example permission check:

```typescript
const canApprove =
  user.roles.includes('approver') || user.roles.includes('admin');
const isCoach = user.roles.includes('coach');
```

### **Security Implementation**

- **HTTPS Only**: Never transmit tokens over HTTP in production
- **CORS Configuration**: Restrict origins to known frontend domains
- **Password Requirements**:
  - Minimum 8 characters
  - At least 1 uppercase letter
  - At least 1 lowercase letter
  - At least 1 number
  - At least 1 special character
- **Rate Limiting**: Implement frontend delays after failed login attempts
- **Error Messages**: Don't reveal if email exists (generic "Invalid credentials")

### **Token Refresh Strategy**

```typescript
// Example refresh logic
const isTokenExpiringSoon = (token) => {
  const payload = JSON.parse(atob(token.split('.')[1]));
  const expiryTime = payload.exp * 1000;
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;
  return expiryTime - now < oneDay;
};

// Refresh if expiring within 1 day
if (isTokenExpiringSoon(accessToken)) {
  await refreshAccessToken(refreshToken);
}
```

### **Error Handling**

- **401 Unauthorized**: Token invalid/expired → Clear tokens, redirect to login
- **403 Forbidden**: Insufficient permissions → Show permission denied message
- **400 Bad Request**: Invalid input → Show validation errors
- **500 Server Error**: System error → Show generic error, log to monitoring

### **Mobile & Accessibility**

- Touch-friendly input fields (minimum 44x44px tap targets)
- Screen reader support with proper ARIA labels
- High contrast mode support
- Keyboard navigation (Tab, Enter, Escape)
- Responsive design for mobile, tablet, desktop
- Loading spinners with aria-live announcements

### **Environment Configuration**

Required environment variables:

```env
# API Configuration
REACT_APP_API_BASE_URL=http://localhost:3000/api

# JWT Configuration (for frontend token parsing)
REACT_APP_TOKEN_REFRESH_THRESHOLD=86400000  # 1 day in ms

# Security
REACT_APP_SESSION_TIMEOUT_WARNING=86400000   # 1 day warning
REACT_APP_SESSION_TIMEOUT=604800000         # 7 days timeout
```

### **Integration Points**

- **Token Balance Module**: Check user's available tokens after login
- **Token Requests Module**: Pre-fill user info in request forms
- **Approval Workflow**: Route requests to user's supervisor
- **User Management**: Admin interface for managing users and roles
- **Audit Logging**: Track all authentication events

### **Testing Requirements**

- Unit tests for authentication utilities
- Integration tests for API client
- E2E tests for login flow
- E2E tests for password change flow
- Role-based access tests
- Token refresh tests
- Session timeout tests
- Cross-browser compatibility testing

### **Performance Optimization**

- Lazy load authentication components
- Minimize token validation overhead
- Cache user profile data
- Optimize auth state updates
- Use React.memo for role-based components
- Implement route code splitting

This authentication module provides the security foundation for the GDEC Tokens system, ensuring proper employee access control, role-based permissions, and comprehensive audit capabilities.
