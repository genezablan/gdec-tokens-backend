# 📋 Token Requests Module — Frontend Implementation Guide

## 📋 Project Brief

Implement the **My Request**, **Approval**, and **New Request** pages covering the full token
request lifecycle:

1. **Employee** submits a request (optionally uploads a supporting document first)
2. **Manager** (`approver` role) reviews and approves or rejects
3. **HR** (`hr_approver` role) does the final review — approval triggers token deduction
4. **Employee** is notified by email at each stage and can cancel while still `pending`

There are 3 request types driven by `development_options`:

| Type               | Tokens | Key rule                                                |
| ------------------ | ------ | ------------------------------------------------------- |
| `task_offloading`  | 1      | Cannot re-apply in the year after an approved request   |
| `coaching`         | 2      | Must pick an employee with `coach` role                 |
| `learning_subsidy` | 1–3    | Employee specifies amount; system calculates token cost |

---

## 🌐 API Endpoints

Base URL: `http://localhost:3000/api`

All endpoints require `Authorization: Bearer <token>` header.

| Method  | Endpoint                              | Purpose                                                  | Auth Required                         |
| ------- | ------------------------------------- | -------------------------------------------------------- | ------------------------------------- | --- | ------- | ------------------------------ | ------------------------------------------------- | ---------------------- | --- | ------- | ---------------------------- | --------------------------------------------- | ---------------------- |
| `POST`  | `/token-requests/upload-attachment`   | Pre-upload a supporting document to S3                   | Any authenticated user                |
| `POST`  | `/token-requests/task-offloading`     | Submit a Task Offloading request (1 token)               | Any authenticated user                |
| `POST`  | `/token-requests/coaching`            | Submit a Coaching request (2 tokens)                     | Any authenticated user                |
| `POST`  | `/token-requests/learning-subsidy`    | Submit a Learning Subsidy request (1–3 tokens)           | Any authenticated user                |
| `GET`   | `/token-requests/my`                  | Employee's own request history                           | Any authenticated user                |
| `GET`   | `/token-requests/pending`             | Combined approval queue (manager + HR items, role-aware) | `approver`, `hr_approver`, or `admin` |
| `GET`   | `/token-requests`                     | All requests (filterable by status)                      | `admin`                               |
| `GET`   | `/token-requests/:id`                 | Get a single request by UUID                             | Any authenticated user                |
| `PATCH` | `/token-requests/:id/manager-approve` | Manager approves → `manager_approved`                    | `approver` or `admin`                 |
| `PATCH` | `/token-requests/:id/manager-reject`  | Manager rejects → `rejected`                             | `approver` or `admin`                 |
| `PATCH` | `/token-requests/:id/hr-approve`      | HR approves → `approved` + tokens deducted               | `hr_approver` or `admin`              |
| `PATCH` | `/token-requests/:id/hr-reject`       | HR rejects → `rejected`                                  | `hr_approver` or `admin`              |     | `PATCH` | `/token-requests/:id/resubmit` | Employee updates and resubmits a rejected request | Any authenticated user |     | `PATCH` | `/token-requests/:id/cancel` | Employee cancels (pending only) → `cancelled` | Any authenticated user |

---

## 📦 Data Models

### `TokenRequest`

```typescript
interface TokenRequest {
  id: string; // UUID
  employeeId: string;
  employee: {
    id: string;
    firstName: string;
    lastName: string;
    employeeId: string; // e.g. "GDC-001"
    department: string;
  };
  developmentOptionId: string;
  developmentOption: {
    id: string;
    name: string;
    type: DevelopmentOptionType;
  };
  type: DevelopmentOptionType; // snapshot at submission time
  tokenCost: number; // snapshot at submission time
  year: number;
  status: RequestStatus;
  queueType: 'manager' | 'hr'; // only present on items returned by GET /pending
  managerId: string | null;
  manager: { id: string; firstName: string; lastName: string } | null;
  managerApprovedAt: string | null;
  hrId: string | null;
  hr: { id: string; firstName: string; lastName: string } | null;
  hrApprovedAt: string | null;
  rejectedById: string | null;
  rejectedByLevel: 'manager' | 'hr' | null;
  rejectionComment: string | null;
  rejectedAt: string | null;
  cancelledAt: string | null;
  formData: Record<string, unknown>;
  attachmentUrl: string | null;
  // ── Employee info snapshot (captured at submission, never changes) ──
  snapshotDepartment: string; // department at time of submission
  snapshotPosition: string; // position at time of submission
  snapshotManagerName: string; // manager's full name at time of submission
  createdAt: string;
  updatedAt: string;
}
```

### Enums

```typescript
enum RequestStatus {
  PENDING = 'pending',
  MANAGER_APPROVED = 'manager_approved',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  CANCELLED = 'cancelled',
}

enum DevelopmentOptionType {
  TASK_OFFLOADING = 'task_offloading',
  COACHING = 'coaching',
  LEARNING_SUBSIDY = 'learning_subsidy',
}
```

### Request Body DTOs

#### `POST /token-requests/task-offloading`

```typescript
interface CreateTaskOffloadingRequestDto {
  developmentOptionId: string; // UUID of the task_offloading development option
  attachmentUrl: string; // Required — S3 URL of the completed form (from upload-attachment)
}
```

#### `POST /token-requests/coaching`

```typescript
interface CreateCoachingRequestDto {
  developmentOptionId: string; // UUID of the coaching development option
  coachId: string; // UUID of a user with the `coach` role
  notes?: string; // Optional coaching goals or notes
  attachmentUrl?: string; // Optional supporting document
}
```

#### `POST /token-requests/learning-subsidy`

```typescript
interface CreateLearningSubsidyRequestDto {
  developmentOptionId: string; // UUID of the learning_subsidy development option
  courseName: string;
  provider: string;
  subsidyAmount: number; // 1000, 2000, or 3000 (PHP). tokenCost = subsidyAmount / 1000
  attachmentUrl?: string; // Optional enrollment proof
}
```

### `formData` Stored on the Request (read-only, returned by GET endpoints)

```typescript
// type === 'task_offloading'  →  formData is always {}
// (all information is in the attachment)

// type === 'coaching'
interface CoachingFormData {
  coachId: string;
  coachName: string; // snapshot of coach's full name at submission time
  notes: string | null;
}

// type === 'learning_subsidy'
interface LearningSubsidyFormData {
  courseName: string;
  provider: string;
  subsidyAmount: number; // e.g. 2000
  tokenCost: number; // e.g. 2
}
```

### `ResubmitTokenRequestDto` (body for `PATCH /:id/resubmit`)

Only send the fields you want to update. Unrecognised fields for the request type are ignored.

```typescript
interface ResubmitTokenRequestDto {
  // task_offloading
  attachmentUrl?: string; // replace the uploaded form

  // coaching
  coachId?: string; // replace the coach (UUID, must have coach role)
  notes?: string; // update coaching notes
  // attachmentUrl also applies

  // learning_subsidy
  courseName?: string;
  provider?: string;
  subsidyAmount?: number; // 1000 | 2000 | 3000 — recalculates tokenCost
  // attachmentUrl also applies
}
```

### `RejectTokenRequestDto` (body for reject endpoints)

```typescript
interface RejectTokenRequestDto {
  comment: string; // Required, max 500 chars
}
```

---

## 🧪 curl Test Commands

Replace `<TOKEN>` with a JWT from `POST /api/auth/login`.
Replace `<ID>` with a real UUID.

### 1. Upload a supporting document (before submitting)

```bash
curl -X POST http://localhost:3000/api/token-requests/upload-attachment \
  -H "Authorization: Bearer <TOKEN>" \
  -F "file=@/path/to/document.pdf"
```

**Response:**

```json
{
  "url": "https://gdec-tokens-development.s3.ap-southeast-1.amazonaws.com/token-request-attachments/...",
  "key": "token-request-attachments/<userId>/<uuid>/document.pdf",
  "fileName": "document.pdf"
}
```

### 2. Submit a Task Offloading request

```bash
curl -X POST http://localhost:3000/api/token-requests/task-offloading \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "developmentOptionId": "<OPTION_UUID>",
    "attachmentUrl": "https://gdec-tokens-development.s3.ap-southeast-1.amazonaws.com/token-request-attachments/.../form.docx"
  }'
```

### 3. Submit a Coaching request

```bash
curl -X POST http://localhost:3000/api/token-requests/coaching \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "developmentOptionId": "<OPTION_UUID>",
    "coachId": "<COACH_USER_UUID>",
    "notes": "Improve leadership and communication skills."
  }'
```

### 4. Submit a Learning Subsidy request

```bash
curl -X POST http://localhost:3000/api/token-requests/learning-subsidy \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "developmentOptionId": "<OPTION_UUID>",
    "courseName": "AWS Cloud Practitioner",
    "provider": "Udemy",
    "subsidyAmount": 2000
  }'
```

### 5. Get my request history

```bash
curl -X GET http://localhost:3000/api/token-requests/my \
  -H "Authorization: Bearer <TOKEN>"
```

### 6. Manager: get pending queue

```bash
curl -X GET http://localhost:3000/api/token-requests/pending \
  -H "Authorization: Bearer <MANAGER_TOKEN>"
```

### 7. Manager: approve a request

```bash
curl -X PATCH http://localhost:3000/api/token-requests/<ID>/manager-approve \
  -H "Authorization: Bearer <MANAGER_TOKEN>"
```

### 8. Manager: reject a request

```bash
curl -X PATCH http://localhost:3000/api/token-requests/<ID>/manager-reject \
  -H "Authorization: Bearer <MANAGER_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{ "comment": "Budget constraints this quarter." }'
```

### 9. Get approval queue (works for manager, HR, or both)

```bash
curl -X GET http://localhost:3000/api/token-requests/pending \
  -H "Authorization: Bearer <TOKEN>"
```

Each item has `queueType: "manager"` or `"hr"` — use it to decide which action buttons to show.

### 10. HR: final approval (deducts tokens)

```bash
curl -X PATCH http://localhost:3000/api/token-requests/<ID>/hr-approve \
  -H "Authorization: Bearer <HR_TOKEN>"
```

### 11. Employee: resubmit a rejected request

```bash
# task_offloading — replace the attachment
curl -X PATCH http://localhost:3000/api/token-requests/<ID>/resubmit \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"attachmentUrl": "https://s3.../updated-form.docx"}'

# learning_subsidy — update amount
curl -X PATCH http://localhost:3000/api/token-requests/<ID>/resubmit \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"subsidyAmount": 1000}'
```

### 12. Employee: cancel a pending request

```bash
curl -X PATCH http://localhost:3000/api/token-requests/<ID>/cancel \
  -H "Authorization: Bearer <TOKEN>"
```

---

## 🎨 Frontend Requirements

### Employee — New Request Page

The **New Request** page shows the 3 development option cards (from `GET /development-options`).
When the employee clicks **"Request"** on a card, open a request form modal.

#### Request Form Modal

The top of the form always shows a **read-only Employee Information section** pre-filled from the
authenticated user's profile. The frontend reads these from the JWT/`GET /auth/me` response and
displays them — they **must not be editable**. The backend snapshots them independently.

```
Employee Information (read-only, auto-filled)
─────────────────────────────────────────────
Department:         [ Finance            ]
Position:           [ Finance Officer    ]
Manager:            [ Juan dela Cruz     ]
Submission Date:    [ February 18, 2026  ]   ← today's date, auto-set
Tokens to be Used:  [ 1 token            ]   ← from developmentOption.tokenCost
```

> **Why snapshot?** If an employee transfers departments after submitting, the request must still
> reflect their department and manager **at the time of submission**. The backend stores
> `snapshotDepartment`, `snapshotPosition`, and `snapshotManagerName` automatically — the
> frontend does not need to send these fields.

1. **Task Offloading** form fields:
   - Supporting Document (**required** — PDF/DOCX — the completed Task Offloading form)
   - Upload flow: `POST /token-requests/upload-attachment` → include returned `url` as `attachmentUrl`
   - No other fields. All request details are in the form document.

2. **Coaching** form fields:
   - Select Coach (dropdown of users with `coach` role — `GET /users?role=coach`)
   - Notes (optional textarea — coaching goals)
   - Supporting Document (optional)

3. **Learning Subsidy** form fields:
   - Course Name (text input, required)
   - Provider / Platform (text input, required)
   - Subsidy Amount (₱1,000 / ₱2,000 / ₱3,000 — toggle or select, required)
   - Token cost is auto-calculated and displayed: `subsidyAmount / 1000` tokens
   - Supporting Document (optional — e.g. course enrollment proof)

#### File Upload Flow

1. Employee selects a file → immediately call `POST /token-requests/upload-attachment`
2. Show upload progress bar
3. On success, store the returned `url` locally — DO NOT show the raw S3 URL to the user, just show the filename
4. On form submit, include `attachmentUrl` in the body

#### Submission Validation (client-side)

- Check `tokenCost <= availableTokens` before submitting (read from `GET /token-balances/me/dashboard`)
- For task offloading: warn if the status badge on the card says the employee was approved last year (backend will still enforce this with a 400 error)

---

### Employee — My Request Page

Show a list/table of the employee's own requests from `GET /token-requests/my`.

Each row shows:

- Request type name (from `developmentOption.name`)
- Token cost
- Year
- **Status badge** (color-coded):

| Status             | Color          |
| ------------------ | -------------- |
| `pending`          | Yellow / Amber |
| `manager_approved` | Blue           |
| `approved`         | Green          |
| `rejected`         | Red            |
| `cancelled`        | Grey           |

- Submitted date (`createdAt`)
- **Cancel button** — visible only when `status === 'pending'`; calls `PATCH /:id/cancel`
- On click of a row, open a detail drawer/modal showing full `formData`, attachment link, and rejection comment if rejected

---

### Approval Page (Manager + HR — unified)

Fetch `GET /token-requests/pending`. The response is a merged list of:

- Items where `queueType === 'manager'` — the user is the assigned manager; status is `pending`
- Items where `queueType === 'hr'` — manager has already approved; status is `manager_approved`

A user with **both** `approver` and `hr_approver` roles will see both sets in one response.

Each row shows:

- Employee name + department
- Request type
- Token cost
- Submitted date
- **Action buttons depend on `queueType`:**

| `queueType` | Approve endpoint                           | Reject endpoint             |
| ----------- | ------------------------------------------ | --------------------------- |
| `manager`   | `PATCH /:id/manager-approve`               | `PATCH /:id/manager-reject` |
| `hr`        | `PATCH /:id/hr-approve` _(deducts tokens)_ | `PATCH /:id/hr-reject`      |

After either action, remove the row from the list optimistically or refetch.

---

### Admin — All Requests View

Table of all requests from `GET /token-requests?status=<filter>`.

- Filter tabs: All / Pending / Manager Approved / Approved / Rejected / Cancelled
- Read-only view with full detail drawer on row click

---

## 🚀 Implementation Steps

### Phase 1 — Employee: Submit a Request

1. On the Development Options page, wire the **"Request"** button to open a type-specific form modal.
2. Build the form fields per type (see above).
3. Implement the pre-upload flow for Task Offloading (required) and other types (optional):
   ```typescript
   async function handleFileSelect(file: File) {
     const form = new FormData();
     form.append('file', file);
     const res = await fetch('/api/token-requests/upload-attachment', {
       method: 'POST',
       headers: { Authorization: `Bearer ${token}` },
       body: form,
     });
     const { url, fileName } = await res.json();
     setAttachmentUrl(url);
     setAttachmentFileName(fileName); // display the filename, not the raw S3 URL
   }
   ```
4. On submit, call the type-specific endpoint:
   - Task Offloading → `POST /token-requests/task-offloading` with `{ developmentOptionId, attachmentUrl }`
   - Coaching → `POST /token-requests/coaching` with `{ developmentOptionId, coachId, notes?, attachmentUrl? }`
   - Learning Subsidy → `POST /token-requests/learning-subsidy` with `{ developmentOptionId, courseName, provider, subsidyAmount, attachmentUrl? }`
5. Show success toast + redirect to My Request page.

### Phase 2 — Employee: My Request Page

6. Fetch `GET /token-requests/my` on mount.
7. Render status badge using the color table above.
8. Wire Cancel button to `PATCH /:id/cancel` with optimistic UI update.
9. Add request detail modal showing `formData` fields and rejection comment.

### Phase 3 — Approval Page (Manager + HR)

10. Fetch `GET /token-requests/pending` on mount (shown for users with `approver` or `hr_approver` role).
11. Render rows. For each row, check `queueType`:
    - `queueType === 'manager'` → show **Approve** (`manager-approve`) and **Reject** (`manager-reject`) buttons
    - `queueType === 'hr'` → show **Final Approve** (`hr-approve`) and **Reject** (`hr-reject`) buttons with a token deduction warning
12. For Reject: show a comment textarea in a confirmation modal before calling the endpoint.
13. Refetch queue after each action.

---

## ✅ Success Criteria

### Must Have

- [ ] Employee can submit all 3 request types via their dedicated endpoints
- [ ] Task Offloading requires an attachment; form rejects submission without one
- [ ] File upload works before submission and `attachmentUrl` is included in the request
- [ ] My Request page shows history with correct status badges
- [ ] Employee can cancel a pending request
- [ ] Manager sees their pending queue and can approve or reject with a comment
- [ ] HR sees the manager-approved queue and can do final approve/reject
- [ ] Token deduction happens only on HR approval

### Should Have

- [ ] Token balance check before submission (client-side warning)
- [ ] Toast notifications after each action
- [ ] Loading states on all async actions
- [ ] Rejection comment visible in request detail modal
- [ ] Attachment download link in request detail

### Nice to Have

- [ ] Real-time queue updates (polling or WebSocket) for manager/HR pages
- [ ] Email notification preview in the detail modal
- [ ] Request timeline showing each status transition with timestamp
