# 🔑 Frontend Implementation Guide: Password Reset

## 📋 Project Brief

Implement a **Password Reset** flow for the GDEC Tokens frontend. Employees who have forgotten their password can request a reset link via email. The link expires in 30 minutes and is single-use.

This feature complements the existing `PATCH /auth/change-password` (which requires the user to be logged in). Password reset is fully public — no authentication required.

---

## 🎯 API Endpoints

**Base URL:** `https://tokens-staging.greatdealscorp.com/api`

| Method | Endpoint                | Purpose                                       | Auth Required |
| ------ | ----------------------- | --------------------------------------------- | ------------- |
| `POST` | `/auth/forgot-password` | Request a password reset email                | No            |
| `POST` | `/auth/reset-password`  | Submit token + new password to complete reset | No            |

---

## 📝 Important Notes

- **`/forgot-password` always returns success** — even if the email doesn't exist. This is intentional to prevent user enumeration. Never show a different message if the email is unknown.
- The reset link is sent to the employee's registered email via AWS SES.
- **Token expires in 30 minutes**. After expiry, the employee must request a new link.
- The token is **single-use** — it is cleared from the DB on successful reset.
- After a successful reset, `isPasswordChanged` is set to `true` (the forced-change screen will not appear again).
- Minimum password length: **8 characters**.

---

## 📐 Data Models

### Request — `POST /auth/forgot-password`

```typescript
{
  email: string; // Employee's registered email
}
```

### Response — `POST /auth/forgot-password`

```typescript
{
  message: string; // Always: "If that email exists, a reset link has been sent."
}
```

---

### Request — `POST /auth/reset-password`

```typescript
{
  email: string; // Same email that was used in forgot-password
  token: string; // Raw token extracted from the reset link URL
  newPassword: string; // Minimum 8 characters
}
```

### Response — `POST /auth/reset-password` (success)

```typescript
{
  message: string; // "Password reset successful. You may now log in."
}
```

### Response — `POST /auth/reset-password` (error)

```typescript
// HTTP 400 Bad Request
{
  statusCode: 400,
  message: "Invalid or expired reset token" // or "Reset token has expired"
}
```

---

## 🔗 Reset Link Format

The backend sends the employee an email containing a link in this format:

```
https://tokens-staging.greatdealscorp.com/reset-password?token=<rawToken>&email=<encodedEmail>
```

The frontend must:

1. Read `token` and `email` from the URL query params on the `/reset-password` page
2. Pass both directly to `POST /auth/reset-password` along with the new password

---

## 🧪 curl Test Commands

### 1. Request reset link

```bash
curl -X POST https://tokens-staging.greatdealscorp.com/api/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email": "employee@greatdealscorp.com"}'
```

**Expected response (always):**

```json
{
  "message": "If that email exists, a reset link has been sent."
}
```

---

### 2. Reset password with token

```bash
curl -X POST https://tokens-staging.greatdealscorp.com/api/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{
    "email": "employee@greatdealscorp.com",
    "token": "<rawTokenFromEmail>",
    "newPassword": "NewPassword123!"
  }'
```

**Expected response (success):**

```json
{
  "message": "Password reset successful. You may now log in."
}
```

**Expected response (invalid/expired token):**

```json
{
  "statusCode": 400,
  "message": "Invalid or expired reset token"
}
```

---

## 🖥️ Frontend Pages Required

### Page 1: Forgot Password (`/forgot-password`)

**Purpose:** Employee enters their email to receive a reset link.

**UI Elements:**

- Email input field
- Submit button ("Send Reset Link")
- Link back to login page

**Behavior:**

1. Employee submits email
2. Call `POST /auth/forgot-password`
3. **Always show the same success message** regardless of response:
   > "If that email is registered, you will receive a password reset link shortly. Please check your inbox."
4. Optionally disable the submit button and show a cooldown ("Resend in 60s") to prevent spam

**Do NOT:**

- Show different messages for found vs. not-found emails
- Redirect to login immediately — let the employee read the confirmation message

---

### Page 2: Reset Password (`/reset-password`)

**Purpose:** Employee sets a new password using the link from their email.

**On page load:**

- Extract `token` and `email` from URL query params
- If either is missing, redirect to `/forgot-password` with an error message: _"Invalid reset link."_

**UI Elements:**

- New password input (with show/hide toggle)
- Confirm new password input
- Submit button ("Reset Password")

**Validation (client-side before API call):**

- New password ≥ 8 characters
- New password and confirm password must match

**Behavior (on submit):**

1. Call `POST /auth/reset-password` with `{ email, token, newPassword }`
2. **On success:** Show success message and redirect to `/login` after 2–3 seconds
   > "Your password has been reset. Redirecting to login..."
3. **On 400 error:** Show inline error
   > "This reset link is invalid or has expired. Please request a new one."
   - Provide a link back to `/forgot-password`

---

## 🔄 Full User Flow Diagram

```
Login Page
    │
    ▼ (clicks "Forgot Password?")
/forgot-password
    │  Enter email → POST /auth/forgot-password
    ▼
"Check your email" confirmation
    │
    ▼ (clicks link in email)
/reset-password?token=xxx&email=yyy
    │  Enter new password → POST /auth/reset-password
    ├── success → redirect to /login
    └── error   → "Link expired" → link back to /forgot-password
```

---

## ✅ Success Criteria

### Must Have

- [ ] `/forgot-password` page accepts email, submits to API, shows neutral confirmation
- [ ] `/reset-password` page reads `token` + `email` from URL params
- [ ] Password and confirm-password fields with client-side match validation
- [ ] API error (400) shows "Invalid or expired" message with link to request a new one
- [ ] On success, redirect to `/login`

### Should Have

- [ ] Show/hide password toggles on both password fields
- [ ] "Forgot Password?" link visible on the login page
- [ ] Loading state on submit buttons

### Nice to Have

- [ ] Resend cooldown timer on `/forgot-password` to prevent spam clicks
- [ ] Password strength indicator
