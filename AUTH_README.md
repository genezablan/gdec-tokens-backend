# Authentication API Documentation

## Overview

The GDEC Tokens Backend uses JWT-based authentication with support for local login (email/password) and OAuth (Microsoft/Google).

## Base URL

All auth endpoints are prefixed with `/api/auth`

---

## 🔐 Authentication Endpoints

### 1. Local Login

**POST** `/api/auth/login`

Login with email or employee ID and password.

**Request Body:**

```json
{
  "email": "user@example.com", // or use employeeId instead
  "employeeId": "202110-42", // optional if email provided
  "password": "yourPassword"
}
```

**Response:**

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "employeeId": "202110-42",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "department": "Operations",
    "position": "Developer",
    "roles": ["employee", "coach"],
    "isPasswordChanged": false
  },
  "requiresPasswordChange": true
}
```

**Status Codes:**

- `200 OK` - Successful login
- `401 Unauthorized` - Invalid credentials
- `400 Bad Request` - Missing required fields

---

### 2. Change Password

**PATCH** `/api/auth/change-password`

Change user password. Required after first login if `isPasswordChanged` is false.

**Headers:**

```
Authorization: Bearer <accessToken>
```

**Request Body:**

```json
{
  "newPassword": "newSecurePassword123!",
  "currentPassword": "oldPassword" // optional for first-time change
}
```

**Response:**

```json
{
  "message": "Password changed successfully"
}
```

**Status Codes:**

- `200 OK` - Password changed
- `400 Bad Request` - Current password incorrect
- `401 Unauthorized` - Not authenticated

---

### 3. Refresh Token

**POST** `/api/auth/refresh`

Get a new access token using refresh token.

**Request Body:**

```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response:**

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Status Codes:**

- `200 OK` - Token refreshed
- `401 Unauthorized` - Invalid or expired refresh token

---

### 4. Get Profile

**GET** `/api/auth/profile`

Get full user profile with relationships.

**Headers:**

```
Authorization: Bearer <accessToken>
```

**Response:**

```json
{
  "id": "uuid",
  "employeeId": "202110-42",
  "email": "user@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "department": "Operations",
  "position": "Developer",
  "roles": ["employee", "coach"],
  "immediateSupervisor": {
    "id": "uuid",
    "firstName": "Jane",
    "lastName": "Manager",
    "position": "Department Head"
  }
}
```

---

### 5. Get Current User (Me)

**GET** `/api/auth/me`

Get basic current user info (lighter than profile).

**Headers:**

```
Authorization: Bearer <accessToken>
```

**Response:**

```json
{
  "id": "uuid",
  "employeeId": "202110-42",
  "email": "user@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "fullName": "John Doe",
  "department": "Operations",
  "position": "Developer",
  "roles": ["employee", "coach"],
  "isPasswordChanged": true
}
```

---

## 🔗 OAuth Endpoints

### 6. Google OAuth

**GET** `/api/auth/google`

Initiates Google OAuth flow. Redirects user to Google login.

**GET** `/api/auth/google/callback`

OAuth callback endpoint (handled automatically).

**Response:** Same as local login response

---

### 7. Microsoft OAuth

**GET** `/api/auth/microsoft`

Initiates Microsoft OAuth flow. Redirects user to Microsoft login.

**GET** `/api/auth/microsoft/callback`

OAuth callback endpoint (handled automatically).

**Response:** Same as local login response

---

## 🔒 Authentication Flows

### First-Time Login Flow

1. User logs in with temporary password (`TempPass123!`)
2. Backend returns `requiresPasswordChange: true`
3. Frontend should prompt user to change password
4. User calls `/auth/change-password` with new password
5. User can now access all features

### OAuth Login Flow

1. Frontend redirects to `/api/auth/google` or `/api/auth/microsoft`
2. User authenticates with OAuth provider
3. Backend validates user email against database
4. If email exists, account is linked and JWT is returned
5. If email doesn't exist, login is rejected (HR must add employee first)

### Token Refresh Flow

1. Access token expires (1 hour by default)
2. Frontend calls `/auth/refresh` with refresh token
3. Backend validates refresh token
4. New access token is returned
5. Refresh token is valid for 7 days

---

## 🛡️ Authorization

### Role-Based Access Control

Use the `@Roles()` decorator on protected routes:

```typescript
@Get('admin-only')
@Roles(UserRole.ADMIN)
@UseGuards(JwtAuthGuard, RolesGuard)
async adminOnly() {
  // Only admins can access
}
```

### Available Roles

- `employee` - All users have this role
- `coach` - Can accept coaching requests
- `approver` - Can approve token requests
- `admin` - Full system access

### Public Routes

Use the `@Public()` decorator to bypass authentication:

```typescript
@Public()
@Get('public-data')
async publicData() {
  // No authentication required
}
```

---

## 🔐 Environment Variables

Add these to your `.env` file:

```env
# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRATION=1h
JWT_REFRESH_EXPIRATION=7d

# Google OAuth (optional)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_CALLBACK_URL=http://localhost:3000/api/auth/google/callback

# Microsoft OAuth (optional)
MICROSOFT_CLIENT_ID=your-microsoft-client-id
MICROSOFT_CLIENT_SECRET=your-microsoft-client-secret
MICROSOFT_CALLBACK_URL=http://localhost:3000/api/auth/microsoft/callback
MICROSOFT_TENANT=common
```

---

## 📝 JWT Payload Structure

```typescript
{
  "sub": "user-uuid",              // User ID
  "employeeId": "202110-42",
  "email": "user@example.com",
  "roles": ["employee", "coach"],
  "firstName": "John",
  "lastName": "Doe",
  "department": "Operations",
  "type": "access",                // or "refresh"
  "iat": 1234567890,              // Issued at
  "exp": 1234571490               // Expires at
}
```

---

## 🧪 Testing Authentication

### Using cURL

**Login:**

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"TempPass123!"}'
```

**Get Profile:**

```bash
curl http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Change Password:**

```bash
curl -X PATCH http://localhost:3000/api/auth/change-password \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"newPassword":"NewSecure123!","currentPassword":"TempPass123!"}'
```

---

## 🚨 Error Responses

All errors follow this format:

```json
{
  "statusCode": 401,
  "message": "Invalid credentials",
  "error": "Unauthorized"
}
```

**Common Error Codes:**

- `400` - Bad Request (validation failed)
- `401` - Unauthorized (invalid credentials or token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found (user doesn't exist)
- `500` - Internal Server Error

---

## 🔄 Token Lifecycle

1. **Access Token**: Expires in 1 hour
   - Used for API requests
   - Stored in memory (not localStorage)
2. **Refresh Token**: Expires in 7 days
   - Used to get new access tokens
   - Can be stored in httpOnly cookie or secure storage
3. **Token Rotation**: When refresh token is used, consider issuing a new refresh token for enhanced security

---

## 📚 Additional Resources

- [Passport.js Documentation](http://www.passportjs.org/)
- [JWT Best Practices](https://tools.ietf.org/html/rfc8725)
- [OAuth 2.0 Guide](https://oauth.net/2/)
