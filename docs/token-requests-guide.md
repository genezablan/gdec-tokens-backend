# 📋 Token Requests — Shared Guide

> **This file covers shared concerns:** data models, approval workflow, and the unified pending queue.
> For submission-specific details, see the type guides:
>
> - [Task Offloading →](./task-offloading-guide.md)
> - [Internal Coaching →](./coaching-guide.md) ← includes session booking & coach availability
> - [Learning Subsidy →](./learning-subsidy-guide.md)

## 📋 Project Brief

Implement the **My Request**, **Approval**, and **New Request** pages covering the full token
request lifecycle:

1. **Employee** submits a request (see type-specific guide for form fields)
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

### Submission (type-specific — see individual guides)

| Method | Endpoint                                                    | Guide                                                             |
| ------ | ----------------------------------------------------------- | ----------------------------------------------------------------- |
| `GET`  | `/token-requests/presigned-upload?fileName=x&contentType=y` | All types — get a pre-signed S3 PUT URL for direct browser upload |
| `POST` | `/token-requests/task-offloading`                           | [task-offloading-guide.md](./task-offloading-guide.md)            |
| `POST` | `/token-requests/coaching`                                  | [coaching-guide.md](./coaching-guide.md)                          |
| `POST` | `/token-requests/learning-subsidy`                          | [learning-subsidy-guide.md](./learning-subsidy-guide.md)          |

### Shared (this guide)

| Method  | Endpoint                              | Purpose                                                   | Auth Required                         |
| ------- | ------------------------------------- | --------------------------------------------------------- | ------------------------------------- |
| `GET`   | `/token-requests/my`                  | Employee's own request history                            | Any authenticated user                |
| `GET`   | `/token-requests/pending`             | Combined approval queue (manager + HR items, role-aware)  | `approver`, `hr_approver`, or `admin` |
| `GET`   | `/token-requests`                     | All requests (filterable by status)                       | `admin`                               |
| `GET`   | `/token-requests/:id`                 | Get a single request by UUID                              | Any authenticated user                |
| `GET`   | `/token-requests/:id/attachment`      | Get a pre-signed download URL for the attachment (15 min) | Any authenticated user                |
| `PATCH` | `/token-requests/:id/manager-approve` | Manager approves → `manager_approved`                     | `approver` or `admin`                 |
| `PATCH` | `/token-requests/:id/manager-reject`  | Manager rejects → `rejected`                              | `approver` or `admin`                 |
| `PATCH` | `/token-requests/:id/hr-approve`      | HR approves → `approved` + tokens deducted                | `hr_approver` or `admin`              |
| `PATCH` | `/token-requests/:id/hr-reject`       | HR rejects → `rejected`                                   | `hr_approver` or `admin`              |
| `PATCH` | `/token-requests/:id/resubmit`        | Employee updates and resubmits a rejected request         | Any authenticated user                |
| `PATCH` | `/token-requests/:id/cancel`          | Employee cancels (pending only) → `cancelled`             | Any authenticated user                |

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
  queueType?: 'manager' | 'hr'; // only present on items from GET /pending
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
  formData: Record<string, unknown>; // type-specific — see individual type guides
  attachmentUrl: string | null; // stored S3 URL — do NOT link directly, bucket is private
  // ── Snapshot (captured at submission, never changes) ──
  snapshotDepartment: string;
  snapshotPosition: string;
  snapshotManagerName: string;
  createdAt: string;
  updatedAt: string;
}
```

> **`formData` shape** varies by request type. See the type-specific guides for details.

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

### Shared DTOs

#### `RejectTokenRequestDto` (body for both reject endpoints)

```typescript
interface RejectTokenRequestDto {
  comment: string; // Required, max 500 chars
}
```

#### `ResubmitTokenRequestDto` (body for `PATCH /:id/resubmit`)

Only send the fields you want to update. Fields not applicable to the request type are ignored.

```typescript
interface ResubmitTokenRequestDto {
  // shared
  attachmentUrl?: string;

  // coaching only
  coachId?: string;
  notes?: string;

  // learning_subsidy only
  courseName?: string;
  provider?: string;
  subsidyAmount?: number; // 1000 | 2000 | 3000 — recalculates tokenCost
}
```

### Employee Info Snapshot

The backend captures these automatically at submission time. The frontend must **display** them in the form (pre-filled from `GET /auth/me`) but must **not** send them in the request body.

| Snapshot field        | Source                              |
| --------------------- | ----------------------------------- |
| `snapshotDepartment`  | `user.department`                   |
| `snapshotPosition`    | `user.position`                     |
| `snapshotManagerName` | `user.immediateSupervisor.fullName` |

If an employee transfers departments after submitting, the request will always reflect their info **at the time of submission**.

---

## 🧪 curl Test Commands

Replace `<TOKEN>` with a JWT from `POST /api/auth/login`.
Replace `<ID>` with a real UUID.

> For submission curl examples, see the type-specific guides.

### 1. Get a pre-signed upload URL

```bash
curl "http://localhost:3000/api/token-requests/presigned-upload?fileName=document.pdf&contentType=application%2Fpdf" \
  -H "Authorization: Bearer <TOKEN>"
```

**Response:**

```json
{
  "uploadUrl": "https://gdec-tokens-development.s3.ap-southeast-1.amazonaws.com/token-request-attachments/...?X-Amz-Signature=...",
  "fileUrl": "https://gdec-tokens-development.s3.ap-southeast-1.amazonaws.com/token-request-attachments/.../document.pdf",
  "key": "token-request-attachments/<userId>/<uuid>/document.pdf"
}
```

Then the browser uploads directly to S3:

```bash
curl -X PUT "<uploadUrl>" \
  -H "Content-Type: application/pdf" \
  --data-binary @/path/to/document.pdf
```

Pass `fileUrl` as `attachmentUrl` when submitting the request.

### 2. Get my request history

```bash
curl http://localhost:3000/api/token-requests/my \
  -H "Authorization: Bearer <TOKEN>"
```

### 3. Get approval queue (manager, HR, or both)

```bash
curl http://localhost:3000/api/token-requests/pending \
  -H "Authorization: Bearer <TOKEN>"
```

Each item has `queueType: "manager"` or `"hr"` — use it to decide which action buttons to show.

### 4. Manager approve

```bash
curl -X PATCH http://localhost:3000/api/token-requests/<ID>/manager-approve \
  -H "Authorization: Bearer <MANAGER_TOKEN>"
```

### 5. Manager reject

```bash
curl -X PATCH http://localhost:3000/api/token-requests/<ID>/manager-reject \
  -H "Authorization: Bearer <MANAGER_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{ "comment": "Budget constraints this quarter." }'
```

### 6. HR final approve (deducts tokens)

```bash
curl -X PATCH http://localhost:3000/api/token-requests/<ID>/hr-approve \
  -H "Authorization: Bearer <HR_TOKEN>"
```

### 7. HR reject

```bash
curl -X PATCH http://localhost:3000/api/token-requests/<ID>/hr-reject \
  -H "Authorization: Bearer <HR_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{ "comment": "Not aligned with current training calendar." }'
```

### 8. Employee cancel

```bash
curl -X PATCH http://localhost:3000/api/token-requests/<ID>/cancel \
  -H "Authorization: Bearer <TOKEN>"
```

### 9. Employee resubmit (after rejection)

```bash
# Replace the attachment (task_offloading or any type)
curl -X PATCH http://localhost:3000/api/token-requests/<ID>/resubmit \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{ "attachmentUrl": "https://s3.../updated-form.docx" }'

# Update subsidy amount (learning_subsidy)
curl -X PATCH http://localhost:3000/api/token-requests/<ID>/resubmit \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{ "subsidyAmount": 1000 }'
```

### 10. Admin: list all requests (with status filter)

```bash
curl "http://localhost:3000/api/token-requests?status=pending" \
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```

### 11. Get a pre-signed download URL for an attachment

```bash
curl http://localhost:3000/api/token-requests/<ID>/attachment \
  -H "Authorization: Bearer <TOKEN>"
# Response: { "url": "https://s3.amazonaws.com/...?X-Amz-Signature=...&X-Amz-Expires=900" }
# Open the url in a new browser tab to download the file. Valid for 15 minutes.
```

---

## 🎨 Frontend Requirements

### Employee — New Request Page

The **New Request** page shows the 3 development option cards (from `GET /development-options`).
When the employee clicks **"Request"** on a card, open a type-specific form modal.

> Form fields vary per type. See the type-specific guides:
>
> - [Task Offloading form](./task-offloading-guide.md)
> - [Coaching form](./coaching-guide.md)
> - [Learning Subsidy form](./learning-subsidy-guide.md)

#### Common Read-only Employee Info Section

All three forms show this at the top, pre-filled from `GET /auth/me`. These fields are **not editable** and are **not sent** in the request body — the backend snapshots them server-side.

```
Employee Information (read-only, auto-filled)
─────────────────────────────────────────────
Department:         [ Finance            ]
Position:           [ Finance Officer    ]
Manager:            [ Juan dela Cruz     ]
Submission Date:    [ February 19, 2026  ]   ← today's date, auto-set
Tokens to be Used:  [ 1 token            ]   ← from developmentOption.tokenCost
```

#### File Upload Flow (all types)

Files are uploaded **directly from the browser to S3** using a pre-signed URL. This avoids routing the file through CloudFront/NestJS.

1. Employee selects a file
2. Call `GET /token-requests/presigned-upload?fileName=<name>&contentType=<mime>` → `{ uploadUrl, fileUrl }`
3. `PUT` the file binary directly to `uploadUrl` with the matching `Content-Type` header
4. Store `fileUrl` locally — display only the file name, not the full URL
5. On form submit, include `attachmentUrl: fileUrl` in the body

```typescript
async function uploadAttachment(file: File, token: string): Promise<string> {
  // Step 1 — get presigned URL from API
  const params = new URLSearchParams({
    fileName: file.name,
    contentType: file.type,
  });
  const res = await fetch(`/api/token-requests/presigned-upload?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const { uploadUrl, fileUrl } = await res.json();

  // Step 2 — upload directly to S3
  await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  });

  return fileUrl; // pass this as attachmentUrl
}
```

#### Pre-submission Token Check

Call `GET /token-balances/me/dashboard` to read `availableTokens`. Warn the employee if `tokenCost > availableTokens` — the backend will also return a 400 error if tokens are insufficient.

---

### Employee — My Request Page

Fetch `GET /token-requests/my`. Show a list/table where each row has:

- Request type name (`developmentOption.name`)
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
- **Resubmit button** — visible only when `status === 'rejected'`; opens type-specific edit modal
- Row click → detail drawer showing `formData`, snapshot info, rejection comment, and attachment link

> **Attachment download:** If `attachmentUrl !== null`, show a **Download Attachment** button.
> On click, call `GET /token-requests/:id/attachment` → returns `{ url }` → open `url` in a new tab.
> **Do NOT link directly to `attachmentUrl`** — the S3 bucket is private and the raw URL will 403.

---

### Approval Page (Manager + HR — unified)

Fetch `GET /token-requests/pending`. The response merges:

- `queueType === 'manager'` items — user is the assigned manager; status is `pending`
- `queueType === 'hr'` items — manager already approved; status is `manager_approved`

A user with **both** `approver` and `hr_approver` roles sees both sets.

Each row:

- Employee name + department (use snapshot fields)
- Request type
- Token cost
- Submitted date
- Action buttons keyed on `queueType`:

| `queueType` | Approve endpoint                           | Reject endpoint             |
| ----------- | ------------------------------------------ | --------------------------- |
| `manager`   | `PATCH /:id/manager-approve`               | `PATCH /:id/manager-reject` |
| `hr`        | `PATCH /:id/hr-approve` _(deducts tokens)_ | `PATCH /:id/hr-reject`      |

Show a confirmation modal with a comment textarea for all reject actions.
Refetch or optimistically remove the row after each action.

---

### Admin — All Requests View

Table from `GET /token-requests?status=<filter>`.

- Filter tabs: All / Pending / Manager Approved / Approved / Rejected / Cancelled
- Read-only; full detail drawer on row click

---

## 🚀 Implementation Steps

### Phase 1 — Request Submission

1. Wire the **"Request"** button on each Development Option card to open the matching form modal.
2. Implement the shared file upload helper (reused across all forms):
   ```typescript
   async function uploadAttachment(file: File, token: string): Promise<string> {
     const params = new URLSearchParams({
       fileName: file.name,
       contentType: file.type,
     });
     const res = await fetch(`/api/token-requests/presigned-upload?${params}`, {
       headers: { Authorization: `Bearer ${token}` },
     });
     const { uploadUrl, fileUrl } = await res.json();
     await fetch(uploadUrl, {
       method: 'PUT',
       headers: { 'Content-Type': file.type },
       body: file,
     });
     return fileUrl;
   }
   ```
3. Build each type-specific form modal (see individual guides).
4. On submit, call the appropriate typed endpoint and show a success toast.

### Phase 2 — My Request Page

5. Fetch `GET /token-requests/my` on mount.
6. Render status badges with the colour table above.
7. Wire Cancel → `PATCH /:id/cancel` with optimistic UI removal.
8. Wire Resubmit → re-open the type-specific form modal pre-filled with existing `formData`.
9. Row click → detail drawer.

### Phase 3 — Approval Page

10. Show for users with `approver` or `hr_approver` role.
11. Fetch `GET /token-requests/pending` on mount.
12. Render rows; derive action buttons from `queueType`.
13. For rejections, show comment modal before calling the endpoint.
14. Refetch after each action.

---

## ✅ Success Criteria

### Must Have

- [ ] Employee can submit all 3 request types
- [ ] File upload works; returned URL is sent as `attachmentUrl`
- [ ] My Requests page shows history with correct status badges
- [ ] Employee can cancel a pending request
- [ ] Rejected employee can resubmit
- [ ] Manager sees their pending queue and can approve or reject with a comment
- [ ] HR sees the manager-approved queue and can do final approve/reject
- [ ] Token deduction happens only on HR approval

### Should Have

- [ ] Token balance check before submission (client-side warning)
- [ ] Toast notifications after each action
- [ ] Loading states on all async actions
- [ ] Rejection comment visible in request detail drawer
- [ ] Snapshot fields (department, position, manager) shown in detail drawer

### Nice to Have

- [ ] Real-time queue updates (polling or WebSocket)
- [ ] Request timeline showing each status transition with timestamp
- [ ] Email notification preview in the detail drawer
