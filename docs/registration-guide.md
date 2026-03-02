# Registration & HR Approval Guide — GDEC Tokens Frontend

## 1. Project Brief

New employees self-register through a public form. The account is created in an **inactive, pending-approval** state — the employee **cannot log in** until HR activates it. HR reviews the queue, approves or rejects each account, and the employee receives an email notification either way.

---

## 2. End-to-End Flow

```
Employee                         Backend                            HR
   │                                │                                │
   ├─ GET /auth/departments ────────►│                                │
   │◄────────────── string[] ───────┤                                │
   │                                │                                │
   ├─ GET /auth/supervisors?dept=X ─►│                                │
   │◄──────────── supervisor[] ─────┤                                │
   │                                │                                │
   ├─ POST /auth/register ──────────►│  Creates user                  │
   │                                │  isActive = false              │
   │                                │  isPendingApproval = true      │
   │◄── 201 { message } ────────────┤                                │
   │    (NO JWT issued)             │                                │
   │                                │                                │
   │  Employee tries to log in      │                                │
   ├─ POST /auth/login ─────────────►│                                │
   │◄── 401 "pending HR approval" ──┤                                │
   │                                │                                │
   │                                │◄── GET /users/pending-regs ────┤
   │                                ├──── pending user list ────────►│
   │                                │                                │
   │                                │◄── PATCH .../approve ──────────┤
   │                                │  isActive = true               │
   │                                │  isPendingApproval = false     │
   │◄── Email: "Account Approved" ──┤────────────────────────────────┤
   │                                │                                │
   ├─ POST /auth/login ─────────────►│                                │
   │◄── 200 { accessToken, user } ──┤                                │
   │    Employee is now logged in   │                                │
```

---

## 3. API Endpoints

| Method  | Endpoint                              | Purpose                                         | Auth Required          |
| ------- | ------------------------------------- | ----------------------------------------------- | ---------------------- |
| `GET`   | `/auth/departments`                   | Distinct department names for the form dropdown | None (public)          |
| `GET`   | `/auth/supervisors?department=<name>` | Active approvers in a department                | None (public)          |
| `POST`  | `/auth/register`                      | Submit self-registration                        | None (public)          |
| `GET`   | `/users/pending-registrations`        | All accounts awaiting HR review                 | `hr_approver`, `admin` |
| `PATCH` | `/users/:id/approve-registration`     | Activate the account                            | `hr_approver`, `admin` |
| `PATCH` | `/users/:id/reject-registration`      | Keep account inactive, notify employee          | `hr_approver`, `admin` |

---

## 4. Important Notes

- `POST /auth/register` returns **HTTP 201 + `{ message }`** — it **never returns a JWT**. The employee must wait for HR to approve before logging in.
- Login with a pending account returns **HTTP 401** with message: `"Your account is pending HR approval. You will be notified by email once approved."`
- Login with an inactive (rejected) account returns **HTTP 401**: `"Account is inactive"`.
- `/auth/departments` and `/auth/supervisors` are **fully public** — no Authorization header needed.
- **Approve**: sets `isActive = true`, `isPendingApproval = false` → sends approval email.
- **Reject**: keeps `isActive = false`, sets `isPendingApproval = false` → sends rejection email with optional reason.
- The `employeeId` (e.g. `GDC-396`) is **auto-generated** by the backend — the employee does not choose it.
- `employeeType` defaults to `Rank and file`. HR can update it later via `PATCH /users/:id/roles`.

---

## 5. Data Models

### `POST /auth/register` — Request

```typescript
interface RegisterRequest {
  firstName: string; // Required
  lastName: string; // Required
  department: string; // Required — must match a value from GET /auth/departments
  immediateSupervisorId: string; // Required — UUID from GET /auth/supervisors
  contact: string; // Required — phone number e.g. "09171234567"
  email: string; // Required — must be unique
  password: string; // Required — min 8 characters
}
```

### `POST /auth/register` — Response (201)

```typescript
interface RegisterResponse {
  message: string;
  // "Registration submitted. Your account is pending HR approval.
  //  You will receive an email once your account is approved."
}
```

### `POST /auth/register` — Error Responses

| Status | Condition                 | `message`                                          |
| ------ | ------------------------- | -------------------------------------------------- |
| 400    | Email already registered  | `"An account with this email already exists"`      |
| 400    | Supervisor UUID not found | `"The selected supervisor does not exist"`         |
| 400    | Validation failure        | Array of field error messages from class-validator |

### `GET /auth/departments` — Response

```typescript
string[]
// Example: ["Accounting", "Finance", "Human Resources", "Information Technology", "Operations", "Sales"]
```

### `GET /auth/supervisors?department=Operations` — Response

```typescript
interface SupervisorOption {
  id: string; // UUID — use as immediateSupervisorId in registration
  fullName: string; // e.g. "Juan Dela Cruz"
  position: string | null;
}
[];
// Empty array [] if no active approvers exist in that department
```

### `GET /users/pending-registrations` — Response

```typescript
interface PendingUser {
  id: string;
  employeeId: string; // Auto-generated e.g. "GDC-396"
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  gender: string | null;
  department: string;
  location: string | null;
  position: string | null;
  employeeType: string; // "Rank and file" (default)
  employeeStatus: string; // "Probationary" (default)
  roles: string[]; // ["employee"]
  isActive: boolean; // false
  isPendingApproval: boolean; // true
  immediateSupervisorId: string;
  contact: string;
  createdAt: string; // ISO 8601 timestamp
  updatedAt: string;
}
[];
```

### `PATCH /users/:id/reject-registration` — Request Body

```typescript
interface RejectRegistrationBody {
  reason?: string; // Optional — shown in the rejection email to the employee
}
```

### `PATCH /users/:id/approve-registration` — Response (200)

Returns the updated user object (same shape as `PendingUser` above) with:

- `isActive: true`
- `isPendingApproval: false`

---

## 6. curl Test Commands

### Get departments

```bash
curl https://tokens-staging.greatdealscorp.com/api/auth/departments
```

### Get supervisors for a department

```bash
curl "https://tokens-staging.greatdealscorp.com/api/auth/supervisors?department=Operations"
```

### Submit registration

```bash
curl -X POST https://tokens-staging.greatdealscorp.com/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "Maria",
    "lastName": "Santos",
    "department": "Operations",
    "immediateSupervisorId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "contact": "09171234567",
    "email": "maria.santos@greatdealscorp.com",
    "password": "MySecurePass123!"
  }'
```

### Try login while pending (should get 401)

```bash
curl -X POST https://tokens-staging.greatdealscorp.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{ "email": "maria.santos@greatdealscorp.com", "password": "MySecurePass123!" }'
```

### List pending registrations (HR)

```bash
curl https://tokens-staging.greatdealscorp.com/api/users/pending-registrations \
  -H "Authorization: Bearer <hr-token>"
```

### Approve a registration

```bash
curl -X PATCH https://tokens-staging.greatdealscorp.com/api/users/<user-id>/approve-registration \
  -H "Authorization: Bearer <hr-token>"
```

### Reject a registration

```bash
curl -X PATCH https://tokens-staging.greatdealscorp.com/api/users/<user-id>/reject-registration \
  -H "Authorization: Bearer <hr-token>" \
  -H "Content-Type: application/json" \
  -d '{ "reason": "Please use your company email address to register." }'
```

### Login after approval (should get 200 + JWT)

```bash
curl -X POST https://tokens-staging.greatdealscorp.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{ "email": "maria.santos@greatdealscorp.com", "password": "MySecurePass123!" }'
```

---

## 7. Frontend Requirements

### Page 1 — Registration Form (`/register`)

This page is publicly accessible and reachable from the login page.

#### Form Fields

| Field              | Input Type | Required | Validation                                | Source                                                  |
| ------------------ | ---------- | -------- | ----------------------------------------- | ------------------------------------------------------- |
| First Name         | Text       | Yes      | Non-empty                                 | Free text                                               |
| Last Name          | Text       | Yes      | Non-empty                                 | Free text                                               |
| Department         | Dropdown   | Yes      | Must select                               | `GET /auth/departments`                                 |
| Reporting To       | Dropdown   | Yes      | Must select; disabled until dept selected | `GET /auth/supervisors?department=<selected>`           |
| Phone Number       | Text / Tel | Yes      | Non-empty                                 | Free text (PH +63 prefix shown in UI)                   |
| Email Address      | Email      | Yes      | Valid email format                        | Free text                                               |
| Password           | Password   | Yes      | Min 8 characters                          | Free text                                               |
| Terms & Conditions | Checkbox   | Yes      | Must be checked to enable submit          | Checkbox; clicking "Terms and Conditions" opens the PDF |

#### Behavior Step by Step

1. **On page load** → Call `GET /auth/departments` → populate the Department dropdown. Show a loading spinner while fetching.
2. **Department selected** → Call `GET /auth/supervisors?department=<value>`:
   - Show a loading state in the Reporting To dropdown.
   - Clear any previously selected Reporting To value.
   - If response is empty → disable dropdown, show helper text: _"No supervisors found for this department. Please contact HR."_
   - Otherwise → populate with `{ value: supervisor.id, label: supervisor.fullName }`.
3. **Submit button** → Disabled until all fields are filled and Terms checkbox is checked.
4. **On submit** → Call `POST /auth/register`:
   - Show a loading/spinner state on the submit button.
   - Map `immediateSupervisorId` to the selected supervisor's `id`.
   - **Success (201)** → Hide the form; show a full-page success state:
     > ✅ **Registration Submitted!**
     > Your account is pending HR approval. You'll receive an email at `{email}` once your account has been reviewed.
   - **Error 400 — email exists** → Show field error on Email: _"An account with this email already exists. Try logging in instead."_
   - **Error 400 — supervisor not found** → Show error under Reporting To.
   - **Error 400 — validation** → Map error messages to their respective fields.
   - **Network / 5xx error** → Show a banner: _"Something went wrong. Please try again."_

#### UI Notes

- Show a link at the top: _"Already have an account? Log in here"_ → `/login`
- The Phone Number input should show a country flag + code prefix (PH +63) matching the design screenshot.

---

### Page 2 — Login Error State (`/login`)

When a registered-but-pending employee tries to log in, the backend returns **HTTP 401** with:

```json
{
  "message": "Your account is pending HR approval. You will be notified by email once approved."
}
```

The frontend must detect this specific message and show a distinct, friendly error — **not** a generic "Invalid credentials" message:

> ⏳ **Account Pending Approval**
> Your account is currently under review by HR. You'll receive an email once it's been approved.

---

### Page 3 — HR Pending Registrations (`/hr/registrations`)

Accessible only to users with `hr_approver` or `admin` role. Add a link in the HR/admin sidebar.

#### Layout

- **Page title**: "Pending Registrations"
- **Badge** in sidebar nav showing the count of pending accounts (from `GET /users/pending-registrations` response length)
- **Table** of pending accounts

#### Table Columns

| Column      | Source field | Notes                          |
| ----------- | ------------ | ------------------------------ |
| Full Name   | `fullName`   |                                |
| Employee ID | `employeeId` | Auto-generated (e.g. GDC-396)  |
| Department  | `department` |                                |
| Email       | `email`      |                                |
| Phone       | `contact`    |                                |
| Submitted   | `createdAt`  | Format: "Feb 23, 2026"         |
| Actions     | —            | Approve button + Reject button |

#### Approve Flow

1. HR clicks **Approve**.
2. Show a brief confirmation: _"Approve [Full Name]'s account?"_
3. Call `PATCH /users/:id/approve-registration`.
4. On success → show green toast: _"[Full Name]'s account has been approved. They will receive an email notification."_
5. Remove the row from the table.

#### Reject Flow

1. HR clicks **Reject**.
2. Open a modal:
   - Title: _"Reject Registration"_
   - Body: _"You are about to reject [Full Name]'s account registration."_
   - Textarea: _"Reason (optional) — this will be included in the email sent to the employee."_
   - Buttons: **Cancel** | **Reject Account** (destructive/red)
3. On confirm → call `PATCH /users/:id/reject-registration` with `{ reason }`.
4. On success → show toast: _"[Full Name]'s registration has been rejected."_
5. Remove the row from the table.

#### Empty State

> ✅ No pending registrations. All accounts have been reviewed.

---

## 8. Email Notifications

All emails are sent automatically by the backend — no frontend action required.

| Trigger                  | Recipient    | Subject                                                            |
| ------------------------ | ------------ | ------------------------------------------------------------------ |
| HR approves registration | **Employee** | `Your Account Has Been Approved — Great Deals Academy`             |
| HR rejects registration  | **Employee** | `Your Account Registration Was Not Approved — Great Deals Academy` |

> **Note:** There is currently no email sent to HR when a new registration is submitted. HR must check the queue manually.

---

## 9. Implementation Phases

### Phase 1 — Employee Registration Page

- [ ] Build `/register` page with all 7 fields + terms checkbox, matching the design
- [ ] `GET /auth/departments` on load → populate Department dropdown
- [ ] `GET /auth/supervisors?department=X` on department change → populate Reporting To dropdown
- [ ] Disable Reporting To until a department is selected
- [ ] Client-side validation (required fields, email format, password min 8 chars, terms checked)
- [ ] `POST /auth/register` on submit with loading state on button
- [ ] Success state (hide form, show success message with the registered email)
- [ ] Error handling: duplicate email, missing supervisor, validation errors, network errors
- [ ] _"Already have an account? Log in here"_ link to `/login`

### Phase 2 — Login Pending State Handling

- [ ] Detect 401 with `"pending HR approval"` in the message
- [ ] Show a distinct "pending approval" UI state instead of generic "invalid credentials"

### Phase 3 — HR Approval Queue

- [ ] Build `/hr/registrations` page (role guard: `hr_approver`, `admin`)
- [ ] `GET /users/pending-registrations` on load → render table
- [ ] Approve action with confirmation → `PATCH .../approve-registration`
- [ ] Reject action with reason modal → `PATCH .../reject-registration`
- [ ] Remove row and show toast on each action
- [ ] Empty state when queue is clear
- [ ] Pending count badge in sidebar nav
- [ ] Sidebar link visible only to `hr_approver` / `admin` roles

---

## 10. Success Criteria

### Must Have

- [ ] Employee completes the registration form and submits successfully.
- [ ] Department and Reporting To dropdowns are dynamically linked.
- [ ] `POST /auth/register` returns a pending confirmation message (no JWT).
- [ ] A pending employee cannot log in and sees a clear "pending approval" message (not "invalid credentials").
- [ ] HR can view all pending registrations.
- [ ] HR can approve → user can now log in → user receives approval email.
- [ ] HR can reject with optional reason → user receives rejection email.

### Should Have

- [ ] Field-level error messages shown inline.
- [ ] Loading states on all async actions.
- [ ] Pending registration count badge in HR sidebar.
- [ ] Row removal after approve/reject without full page reload.

### Nice to Have

- [ ] Terms and Conditions PDF viewable inline before checking the checkbox.
- [ ] HR email notification when a new registration is submitted.
- [ ] Search/filter on the pending registrations table.
- [ ] HR can expand a row to view the full submitted profile before approving.
