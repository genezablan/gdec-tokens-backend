# 📋 Task Offloading — Frontend Implementation Guide

> **Parent guide:** [Token Requests — Shared Guide](./token-requests-guide.md)

## 📋 Brief

**Task Offloading** lets an employee hand off an OTJ task or special project to a colleague.

| Field       | Value                                                                                  |
| ----------- | -------------------------------------------------------------------------------------- |
| Token cost  | **1 token** (fixed, configured in `development_options`)                               |
| Attachment  | **Required** — employee downloads, fills, and uploads the blank form template          |
| Repeat rule | Cannot apply in the year **immediately following** an approved task offloading request |

---

## 🌐 API Endpoints

Base URL: `http://localhost:3000/api`

| Method | Endpoint                            | Purpose                             | Auth Required          |
| ------ | ----------------------------------- | ----------------------------------- | ---------------------- |
| `POST` | `/token-requests/upload-attachment` | Pre-upload the completed form to S3 | Any authenticated user |
| `POST` | `/token-requests/task-offloading`   | Submit a Task Offloading request    | Any authenticated user |

Shared endpoints (cancel, resubmit, approve/reject, view) are in [token-requests-guide.md](./token-requests-guide.md).

---

## 📦 Data Models

### Request Body

```typescript
interface CreateTaskOffloadingRequestDto {
  developmentOptionId: string; // UUID of the task_offloading development option
  attachmentUrl: string; // Required — S3 URL from POST /upload-attachment
}
```

### `formData` on the saved request

Task Offloading stores no additional `formData`. The completed form is entirely in the attachment.

```typescript
// request.formData is always {}
```

### `ResubmitTokenRequestDto` (task offloading fields only)

```typescript
interface ResubmitTaskOffloadingDto {
  attachmentUrl?: string; // Replace the uploaded form
}
```

---

## 🧪 curl Test Commands

Replace `<TOKEN>` with a JWT from `POST /api/auth/login`.

### 1. Get the Task Offloading development option (to obtain `developmentOptionId`)

```bash
curl http://localhost:3000/api/development-options \
  -H "Authorization: Bearer <TOKEN>"
```

Look for the entry with `"type": "task_offloading"`. Copy its `id`.

### 2. Download the blank form template

The development option object includes `formTemplateUrl`. Direct the employee to download it:

```json
{
  "id": "<OPTION_UUID>",
  "name": "Task Offloading",
  "type": "task_offloading",
  "tokenCost": 1,
  "formTemplateUrl": "https://gdec-tokens.s3.ap-southeast-1.amazonaws.com/form-templates/task-offloading-form.docx",
  "formTemplateFileName": "task-offloading-form.docx"
}
```

### 3. Upload the completed form

```bash
curl -X POST http://localhost:3000/api/token-requests/upload-attachment \
  -H "Authorization: Bearer <TOKEN>" \
  -F "file=@/path/to/filled-form.docx"
```

**Response:**

```json
{
  "url": "https://gdec-tokens.s3.ap-southeast-1.amazonaws.com/token-request-attachments/.../filled-form.docx",
  "key": "token-request-attachments/<userId>/<uuid>/filled-form.docx",
  "fileName": "filled-form.docx"
}
```

### 4. Submit the request

```bash
curl -X POST http://localhost:3000/api/token-requests/task-offloading \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "developmentOptionId": "<OPTION_UUID>",
    "attachmentUrl": "https://gdec-tokens.s3.ap-southeast-1.amazonaws.com/token-request-attachments/.../filled-form.docx"
  }'
```

### 5. Resubmit after rejection (replace attachment)

```bash
curl -X PATCH http://localhost:3000/api/token-requests/<REQUEST_ID>/resubmit \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{ "attachmentUrl": "https://gdec-tokens.s3.ap-southeast-1.amazonaws.com/token-request-attachments/.../updated-form.docx" }'
```

---

## 🎨 Frontend Requirements

### Task Offloading Form Modal

Opened when the employee clicks **"Request"** on the Task Offloading card.

```
Employee Information (read-only — auto-filled from auth/me)
───────────────────────────────────────────────────────────
Department:         [ Finance            ]
Position:           [ Finance Officer    ]
Manager:            [ Juan dela Cruz     ]
Submission Date:    [ February 19, 2026  ]
Tokens to be Used:  [ 1 token            ]

Form Template
─────────────
[ ⬇ Download Blank Form ] ← links to developmentOption.formTemplateUrl

Supporting Document  * required
──────────────────────────────
[ 📎 Choose file... ]
  › filled-task-offloading-form.docx  ✓ uploaded   ← show filename after upload
```

#### Behaviour

1. Show a **Download Blank Form** button pointing to `developmentOption.formTemplateUrl`.
   The employee must fill this out offline and re-upload it.
2. On file select → immediately upload via `POST /upload-attachment` and show a spinner.
3. Block the **Submit** button until a file is successfully uploaded.
4. On submit → `POST /token-requests/task-offloading` with `{ developmentOptionId, attachmentUrl }`.
5. Check `availableTokens >= 1` before submission; show a warning if not.
6. If the employee had an **approved** task offloading request last year, show a warning
   (backend will enforce with 400 — the frontend warning is just UX).

#### Resubmit Modal

Pre-fill with the existing request's data. Allow replacing the attachment only.
Submit via `PATCH /:id/resubmit` with `{ attachmentUrl }`.

---

## ✅ Success Criteria

### Must Have

- [ ] Employee can download the blank form template
- [ ] File upload is required — Submit button is disabled until upload succeeds
- [ ] Uploaded filename is shown (not the raw S3 URL)
- [ ] Request is created with `status: pending` and the attachment URL saved
- [ ] Employee can resubmit a rejected request with a new attachment

### Should Have

- [ ] Upload progress indicator
- [ ] Clear error message if upload fails
- [ ] Token balance warning before submission
- [ ] Attachment download link visible in request detail drawer

### Nice to Have

- [ ] Inline PDF/DOCX preview of the uploaded form
- [ ] Repeat-year warning if last year's request was approved
