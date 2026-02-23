# Manager Approvals History — API Reference

**Base URL:** `http://localhost:3000/api`
All endpoints require `Authorization: Bearer <token>`.

---

## Endpoints

### `GET /token-requests/my-approvals`

Returns the full history of every token request the authenticated manager was
ever assigned to, across all statuses.

**Auth:** `approver`, `admin`

#### Query Parameters

| Param | Type   | Required | Description                                                 |
| ----- | ------ | -------- | ----------------------------------------------------------- |
| `tab` | string | No       | Filter by status group. See tab values below. Omit for all. |

#### `tab` Values

| Value       | Statuses returned              |
| ----------- | ------------------------------ |
| _(omitted)_ | All statuses                   |
| `pending`   | `pending`                      |
| `approved`  | `manager_approved`, `approved` |
| `rejected`  | `rejected`, `cancelled`        |

#### Response `200 OK`

Array of `TokenRequest` objects, ordered by `createdAt DESC`.

```json
[
  {
    "id": "uuid",
    "type": "task_offloading",
    "tokenCost": 1,
    "year": 2026,
    "status": "manager_approved",
    "employeeId": "uuid",
    "employee": {
      "id": "uuid",
      "firstName": "Maria",
      "lastName": "Santos",
      "employeeId": "GDC-042",
      "department": "Finance"
    },
    "developmentOptionId": "uuid",
    "developmentOption": {
      "id": "uuid",
      "name": "Task Offloading",
      "type": "task_offloading"
    },
    "snapshotDepartment": "Finance",
    "snapshotPosition": "Finance Officer",
    "snapshotManagerName": "Juan dela Cruz",
    "managerId": "uuid",
    "manager": { "id": "uuid", "firstName": "Juan", "lastName": "dela Cruz" },
    "managerApprovedAt": "2026-02-20T06:10:00.000Z",
    "hrId": null,
    "hr": null,
    "hrApprovedAt": null,
    "rejectedById": null,
    "rejectedByLevel": null,
    "rejectionComment": null,
    "rejectedAt": null,
    "cancelledAt": null,
    "formData": { "projectName": "Q1 OJT", "projectDescription": "..." },
    "attachmentUrl": null,
    "createdAt": "2026-02-19T02:35:00.000Z",
    "updatedAt": "2026-02-20T06:10:00.000Z"
  }
]
```

> **Note:** `attachmentUrl` is a raw private S3 URL. Do NOT link to it
> directly — use `GET /token-requests/:id/attachment` to get a signed URL.

---

### `GET /token-requests/:id/attachment`

Returns a pre-signed S3 download URL for the request's attachment.
Valid for **15 minutes**.

**Auth:** Any authenticated user

#### Path Parameters

| Param | Type | Description        |
| ----- | ---- | ------------------ |
| `id`  | UUID | Token request UUID |

#### Response `200 OK`

```json
{
  "url": "https://gdec-tokens.s3.ap-southeast-1.amazonaws.com/...?X-Amz-Expires=900&X-Amz-Signature=..."
}
```

#### Error Responses

| Status | Condition                 |
| ------ | ------------------------- |
| `400`  | Request has no attachment |
| `404`  | Request ID not found      |

---

## Data Types

### `TokenRequest`

```typescript
interface TokenRequest {
  id: string; // UUID
  type: DevelopmentOptionType; // Snapshot at submission time
  tokenCost: number; // Snapshot at submission time
  year: number; // e.g. 2026
  status: RequestStatus;

  // Submitter
  employeeId: string;
  employee: {
    id: string;
    firstName: string;
    lastName: string;
    employeeId: string; // e.g. "GDC-042"
    department: string;
  };

  // Snapshot — captured at submission, never changes
  snapshotDepartment: string;
  snapshotPosition: string | null;
  snapshotManagerName: string;

  // Development option
  developmentOptionId: string;
  developmentOption: {
    id: string;
    name: string;
    type: DevelopmentOptionType;
  };

  // Manager (you)
  managerId: string;
  manager: { id: string; firstName: string; lastName: string } | null;
  managerApprovedAt: string | null; // ISO 8601 — null if still pending

  // HR
  hrId: string | null;
  hr: { id: string; firstName: string; lastName: string } | null;
  hrApprovedAt: string | null;

  // Rejection
  rejectedById: string | null;
  rejectedByLevel: 'manager' | 'hr' | null;
  rejectionComment: string | null;
  rejectedAt: string | null;

  // Cancellation
  cancelledAt: string | null;

  // Request-specific payload — shape varies by type (see below)
  formData: Record<string, unknown>;

  // Private S3 URL — never link directly, use /attachment endpoint
  attachmentUrl: string | null;

  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}
```

### `formData` Shapes by Type

```typescript
// type === 'task_offloading'
{ projectName: string; projectDescription: string; ojt?: boolean }

// type === 'coaching'
{ coachId: string; coachName: string }

// type === 'learning_subsidy'
{ courseName: string; provider: string; amount: number; tokenCount: number }
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

---

## curl Examples

```bash
# All history (no filter)
curl http://localhost:3000/api/token-requests/my-approvals \
  -H "Authorization: Bearer <TOKEN>"

# Still-pending items only
curl "http://localhost:3000/api/token-requests/my-approvals?tab=pending" \
  -H "Authorization: Bearer <TOKEN>"

# Items you already actioned (awaiting HR or fully approved)
curl "http://localhost:3000/api/token-requests/my-approvals?tab=approved" \
  -H "Authorization: Bearer <TOKEN>"

# Rejected / cancelled items
curl "http://localhost:3000/api/token-requests/my-approvals?tab=rejected" \
  -H "Authorization: Bearer <TOKEN>"

# Get a signed download URL for an attachment (open in browser, expires in 15 min)
curl "http://localhost:3000/api/token-requests/<ID>/attachment" \
  -H "Authorization: Bearer <TOKEN>"
```

---

## Status Guide

| `status`           | Meaning                                                 |
| ------------------ | ------------------------------------------------------- |
| `pending`          | Submitted but you have not acted yet                    |
| `manager_approved` | You approved — waiting for HR to do the final review    |
| `approved`         | HR approved — tokens deducted from employee             |
| `rejected`         | Rejected at manager or HR level — see `rejectedByLevel` |
| `cancelled`        | Cancelled by the employee before you acted              |

### Reading `rejectedByLevel`

| `rejectedByLevel` | Means                             |
| ----------------- | --------------------------------- |
| `'manager'`       | You (the manager) rejected it     |
| `'hr'`            | HR rejected it after you approved |
| `null`            | Not rejected — ignore this field  |
