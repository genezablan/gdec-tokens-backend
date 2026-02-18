# Login API Guide

Simple guide for implementing the login flow in your frontend.

## API Base URL

```
http://localhost:3000/api
```

---

## 1. Login

**Endpoint:** `POST /auth/login`

**Request Body:**

```json
{
  "email": "gm.zablan@greatdealscorp.com",
  "password": "TempPass123!"
}
```

**Success Response (200):**

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOjEsImVtYWlsIjoiZ20uemFibGFuQGdyZWF0ZGVhbHNjb3JwLmNvbSIsImVtcGxveWVlSWQiOiIyMDI0MDktMDkiLCJyb2xlcyI6WyJlbXBsb3llZSIsImFkbWluIl0sImlhdCI6MTcwODQ5MjgwMCwiZXhwIjoxNzA5MDk3NjAwfQ...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "sub": 1,
    "email": "gm.zablan@greatdealscorp.com",
    "employeeId": "202409-09",
    "roles": ["employee", "admin"]
  }
}
```

**Error Response (401):**

```json
{
  "message": "Invalid credentials",
  "error": "Unauthorized",
  "statusCode": 401
}
```

---

## 2. Get Current User

**Endpoint:** `GET /auth/me`

**Headers:**

```
Authorization: Bearer {accessToken}
```

**Success Response (200):**

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

---

## 3. Get Profile (with Supervisor)

**Endpoint:** `GET /auth/profile`

**Headers:**

```
Authorization: Bearer {accessToken}
```

**Success Response (200):**

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
  "isActive": true,
  "lastLoginAt": "2026-02-17T08:30:00.000Z",
  "immediateSupervisor": {
    "id": 5,
    "employeeId": "202403-15",
    "email": "john.smith@greatdealscorp.com",
    "fullName": "John Smith"
  }
}
```

---

## 4. Change Password

**Endpoint:** `PATCH /auth/change-password`

**Headers:**

```
Authorization: Bearer {accessToken}
```

**Request Body:**

```json
{
  "oldPassword": "TempPass123!",
  "newPassword": "MyNewSecurePass456!"
}
```

**Success Response (200):**

```json
{
  "message": "Password changed successfully. This is your first password change.",
  "isFirstPasswordChange": true
}
```

---

## 5. Refresh Token

**Endpoint:** `POST /auth/refresh`

**Request Body:**

```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Success Response (200):**

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

---

## Complete Login Flow

### Step 1: Login

```javascript
const loginResponse = await fetch('http://localhost:3000/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'gm.zablan@greatdealscorp.com',
    password: 'TempPass123!',
  }),
});

const { accessToken, refreshToken, user } = await loginResponse.json();

// Store tokens
localStorage.setItem('accessToken', accessToken);
localStorage.setItem('refreshToken', refreshToken);
```

### Step 2: Get User Profile

```javascript
const profileResponse = await fetch('http://localhost:3000/api/auth/profile', {
  headers: {
    Authorization: `Bearer ${accessToken}`,
  },
});

const userProfile = await profileResponse.json();

// Check if first-time user
if (!userProfile.isPasswordChanged) {
  // Show change password modal
}
```

### Step 3: Change Password (if first time)

```javascript
const changePasswordResponse = await fetch(
  'http://localhost:3000/api/auth/change-password',
  {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      oldPassword: 'TempPass123!',
      newPassword: 'MyNewSecurePass456!',
    }),
  },
);

const { message, isFirstPasswordChange } = await changePasswordResponse.json();
```

### Step 4: Make Authenticated Requests

```javascript
// Add token to all subsequent requests
const response = await fetch('http://localhost:3000/api/some-endpoint', {
  headers: {
    Authorization: `Bearer ${accessToken}`,
  },
});
```

### Step 5: Handle Token Refresh

```javascript
// Refresh token before it expires (every 6 days)
const refreshResponse = await fetch('http://localhost:3000/api/auth/refresh', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    refreshToken: localStorage.getItem('refreshToken'),
  }),
});

const { accessToken: newAccessToken, refreshToken: newRefreshToken } =
  await refreshResponse.json();

localStorage.setItem('accessToken', newAccessToken);
localStorage.setItem('refreshToken', newRefreshToken);
```

### Step 6: Logout

```javascript
// Clear tokens
localStorage.removeItem('accessToken');
localStorage.removeItem('refreshToken');

// Redirect to login
window.location.href = '/login';
```

---

## Important Notes

- **Default Password**: All employees start with `TempPass123!`
- **Login Options**: Use email only
- **Token Expiry**: Access tokens valid for 7 days
- **First Login**: Users must change password on first login
- **Protected Routes**: Include `Authorization: Bearer {token}` header
- **Roles**: `employee`, `coach`, `approver`, `admin`

---

## Test Credentials

```
Email: gm.zablan@greatdealscorp.com
Password: TempPass123!
```

---

## Error Handling

**401 Unauthorized** - Invalid credentials or expired token

```javascript
if (response.status === 401) {
  // Clear tokens and redirect to login
  localStorage.clear();
  window.location.href = '/login';
}
```

**403 Forbidden** - Insufficient permissions

```javascript
if (response.status === 403) {
  // Show permission denied message
  alert('You do not have permission to access this resource');
}
```
