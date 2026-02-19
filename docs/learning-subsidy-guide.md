# 📋 Learning Subsidy — Frontend Implementation Guide

> **Parent guide:** [Token Requests — Shared Guide](./token-requests-guide.md)

## 📋 Brief

**Learning Subsidy** subsidises an employee's enrollment in an external course or training program.

| Field          | Value                                                                    |
| -------------- | ------------------------------------------------------------------------ |
| Token cost     | **1–3 tokens** (₱1,000 per token, max ₱3,000 / 3 tokens)                 |
| Subsidy amount | ₱1,000 / ₱2,000 / ₱3,000 — employee chooses; token cost = amount ÷ 1,000 |
| Attachment     | Optional — e.g. enrollment proof, course brochure                        |
| Repeat rule    | No restriction on consecutive years                                      |

---

## 🌐 API Endpoints

Base URL: `http://localhost:3000/api`

| Method | Endpoint                           | Purpose                           | Auth Required          |
| ------ | ---------------------------------- | --------------------------------- | ---------------------- |
| `POST` | `/token-requests/learning-subsidy` | Submit a Learning Subsidy request | Any authenticated user |

Shared endpoints (cancel, resubmit, approve/reject, view) are in [token-requests-guide.md](./token-requests-guide.md).

---

## 📦 Data Models

### Request Body

```typescript
interface CreateLearningSubsidyRequestDto {
  developmentOptionId: string; // UUID of the learning_subsidy development option
  subsidyAmount: number; // 1000 | 2000 | 3000 (PHP) — tokenCost = subsidyAmount / 1000
  attachmentUrl?: string; // Optional — S3 URL returned by GET /presigned-upload
}
```

### `formData` on the saved request

```typescript
interface LearningSubsidyFormData {
  subsidyAmount: number; // e.g. 2000
  tokenCost: number; // e.g. 2 (always subsidy / 1000)
}
```

### `ResubmitTokenRequestDto` (learning subsidy fields only)

```typescript
interface ResubmitLearningSubsidyDto {
  subsidyAmount?: number; // 1000 | 2000 | 3000 — recalculates tokenCost
  attachmentUrl?: string;
}
```

---

## 🧪 curl Test Commands

Replace `<TOKEN>` with a JWT from `POST /api/auth/login`.

### 1. Get the Learning Subsidy development option

```bash
curl http://localhost:3000/api/development-options \
  -H "Authorization: Bearer <TOKEN>"
```

Look for `"type": "learning_subsidy"`. Copy its `id`.

### 2. Submit (no attachment)

```bash
curl -X POST http://localhost:3000/api/token-requests/learning-subsidy \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "developmentOptionId": "<OPTION_UUID>",
    "subsidyAmount": 2000
  }'
```

### 3. Submit with enrollment proof

```bash
# Step 1 — get presigned URL
curl "http://localhost:3000/api/token-requests/presigned-upload?fileName=enrollment-proof.pdf&contentType=application%2Fpdf" \
  -H "Authorization: Bearer <TOKEN>"

# Step 2 — upload directly to S3
curl -X PUT "<uploadUrl>" \
  -H "Content-Type: application/pdf" \
  --data-binary @/path/to/enrollment-proof.pdf

# Step 3 — submit with the returned fileUrl
curl -X POST http://localhost:3000/api/token-requests/learning-subsidy \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "developmentOptionId": "<OPTION_UUID>",
    "subsidyAmount": 2000,
    "attachmentUrl": "https://gdec-tokens.s3.ap-southeast-1.amazonaws.com/token-request-attachments/.../enrollment-proof.pdf"
  }'
```

### 4. Resubmit after rejection

```bash
# Reduce amount to 1 token
curl -X PATCH http://localhost:3000/api/token-requests/<REQUEST_ID>/resubmit \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "subsidyAmount": 1000
  }'
```

---

## 🎨 Frontend Requirements

### Learning Subsidy Form Modal

```
Employee Information (read-only — auto-filled)
────────────────────────────────────────────────
Department:  [ Finance ]   Position: [ Finance Officer ]
Manager:     [ Juan dela Cruz ]   Date: [ Feb 19, 2026 ]

Subsidy Amount *
────────────────
  ○ ₱1,000  (1 token)
  ● ₱2,000  (2 tokens)   ← selected
  ○ ₱3,000  (3 tokens)

Tokens to be Used: [ 2 tokens ]   ← live-computed from selection

Supporting Document (optional)
────────────────────────────────
[ 📎 Choose file... ]
  › enrollment-proof.pdf  ✓ uploaded
```

#### Behaviour

1. Subsidy amount uses a **toggle / radio group** — only ₱1,000, ₱2,000, or ₱3,000 are valid.
2. **Tokens to be Used** updates live as the employee selects an amount: `subsidyAmount / 1000`.
3. Check `availableTokens >= tokenCost` before submitting; show a warning if insufficient.
4. File upload is optional — follow the shared upload flow if a file is attached.
5. On submit → `POST /token-requests/learning-subsidy` with `developmentOptionId`, `subsidyAmount`, and optionally `attachmentUrl`.

#### Resubmit Modal

Pre-fill with existing `formData` (subsidyAmount).
Employee can change the amount or attach a new document. Submit via `PATCH /:id/resubmit`.

---

## ✅ Success Criteria

### Must Have

- [ ] Subsidy amount is constrained to ₱1,000 / ₱2,000 / ₱3,000
- [ ] Live token cost preview updates when amount changes
- [ ] Token balance warning if cost exceeds available tokens
- [ ] Request created with `formData` containing subsidyAmount and tokenCost
- [ ] Employee can resubmit with a different subsidy amount

### Should Have

- [ ] Upload progress indicator for optional attachment
- [ ] Attachment download link visible in request detail drawer
- [ ] Show `subsidyAmount` formatted as `₱2,000` throughout the UI
