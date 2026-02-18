# 🛠️ Development Options Module — Frontend Implementation Guide

## 📋 Project Brief

Implement the **Development Options** page (admin settings) and the **Request Type Cards** shown to employees when they want to spend tokens.

There are exactly **3 development option types** — each is a configurable card that shows:

- Name and description
- Token cost (displayed as a gold badge)
- Whether it is currently active
- A downloadable blank form template (if uploaded)

**Admin** users can:

- Edit name, description, token cost, active status, and per-type rules
- Toggle a type on/off (quick action without full edit)
- Upload/replace the blank form template (PDF/DOCX)

**Employees and other users** only see active options.

---

## 🌐 API Endpoints

Base URL: `http://localhost:3000/api`

All endpoints require `Authorization: Bearer <token>` header.

| Method  | Endpoint                            | Purpose                                              | Auth Required          |
| ------- | ----------------------------------- | ---------------------------------------------------- | ---------------------- |
| `GET`   | `/development-options`              | List all development options (active only)           | Any authenticated user |
| `GET`   | `/development-options?all=true`     | List ALL options including inactive                  | Admin only             |
| `GET`   | `/development-options/:id`          | Get a single development option by UUID              | Any authenticated user |
| `PATCH` | `/development-options/:id`          | Update name, description, tokenCost, isActive, rules | Admin only             |
| `PATCH` | `/development-options/:id/toggle`   | Flip isActive on/off                                 | Admin only             |
| `POST`  | `/development-options/:id/template` | Upload/replace blank form template (multipart)       | Admin only             |
| `POST`  | `/development-options/seed`         | Re-run seed if options are missing                   | Admin only             |

### ⚠️ Important Notes

- **IDs are UUIDs** — fetch the list first to get real IDs; do not hardcode them
- The `?all=true` query param is ignored for non-admin roles — they always receive active-only options
- The 3 types (`task_offloading`, `coaching`, `learning_subsidy`) are seeded automatically on server start; the **POST /seed** endpoint is a manual fallback
- `tokenCost` is admin-configurable — **always read it from the API**, never hardcode token values in the frontend
- `rules` is a JSON object whose shape differs per type (see Data Models below)
- Form template uploads must be `multipart/form-data` with field name `file`

---

## 📦 Data Models

### `DevelopmentOption` (TypeScript Interface)

```typescript
interface DevelopmentOption {
  id: string; // UUID
  type: DevelopmentOptionType; // 'task_offloading' | 'coaching' | 'learning_subsidy'
  name: string; // Display name (admin-editable)
  description: string | null; // Short description (admin-editable)
  tokenCost: number; // Tokens required (admin-configurable)
  isActive: boolean; // Whether employees can request this type
  rules: TaskOffloadingRules | CoachingRules | LearningSubsidyRules;
  formTemplateUrl: string | null; // S3 URL for blank form download
  formTemplateFileName: string | null; // Original filename for display
  updatedBy: {
    id: string;
    firstName: string;
    lastName: string;
  } | null;
  updatedAt: string; // ISO datetime
  createdAt: string; // ISO datetime
}
```

### Enum: `DevelopmentOptionType`

```typescript
enum DevelopmentOptionType {
  TASK_OFFLOADING = 'task_offloading',
  COACHING = 'coaching',
  LEARNING_SUBSIDY = 'learning_subsidy',
}
```

### Rules JSON — Shape per Type

Each type has a different `rules` object. Always parse using the `type` field as a discriminator:

```typescript
// type === 'task_offloading'
interface TaskOffloadingRules {
  consecutiveYearRepeatAllowed: boolean; // false = cannot re-apply in the year after approval
  features: string[]; // bullet points to display on the card
  // default: ['1 token per OTJ or special project', 'No consecutive-year repeat']
}

// type === 'coaching'
interface CoachingRules {
  sessionsRequired: number; // 3
  sameCoachRequired: boolean; // true = all 3 sessions must use the same coach
  features: string[]; // bullet points to display on the card
  // default: ['2 tokens for 3 sessions', 'Same coach per cycle']
}

// type === 'learning_subsidy'
interface LearningSubsidyRules {
  subsidyPerToken: number; // 1000 (₱1,000 per token)
  maxSubsidyAmount: number; // 3000 (₱3,000 max)
  maxTokens: number; // 3 (1–3 tokens selectable by employee)
  features: string[]; // bullet points to display on the card
  // default: ['1 token equal to ₱1,000.00', 'Maximum of ₱3,000.00']
}
```

> **Key point:** `rules.features` is the authoritative bullet list for each card. Always render it as-is from the API — never hardcode the bullet text in the frontend.

### `UpdateDevelopmentOptionDto` (Request Body for PATCH)

```typescript
interface UpdateDevelopmentOptionDto {
  name?: string;
  description?: string;
  tokenCost?: number; // integer, min: 1
  isActive?: boolean;
  rules?: Record<string, unknown>; // JSON object — shape validated by admin
}
```

---

## 🧪 curl Test Commands

Replace `<TOKEN>` with the JWT from `POST /api/auth/login` (admin credentials).
Replace `<ID>` with a real UUID from the list endpoint.

### 1. List active options (employee view)

```bash
curl -X GET http://localhost:3000/api/development-options \
  -H "Authorization: Bearer <TOKEN>"
```

### 2. List ALL options including inactive (admin view)

```bash
curl -X GET "http://localhost:3000/api/development-options?all=true" \
  -H "Authorization: Bearer <TOKEN>"
```

### 3. Get a single option

```bash
curl -X GET http://localhost:3000/api/development-options/<ID> \
  -H "Authorization: Bearer <TOKEN>"
```

### 4. Update an option (admin)

```bash
curl -X PATCH http://localhost:3000/api/development-options/<ID> \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Task Offloading",
    "description": "Offload an OJT or special project assignment",
    "tokenCost": 1,
    "isActive": true,
    "rules": { "consecutiveYearRepeatAllowed": false }
  }'
```

### 5. Toggle active status (admin)

```bash
curl -X PATCH http://localhost:3000/api/development-options/<ID>/toggle \
  -H "Authorization: Bearer <TOKEN>"
```

### 6. Upload a form template (admin)

```bash
curl -X POST http://localhost:3000/api/development-options/<ID>/template \
  -H "Authorization: Bearer <TOKEN>" \
  -F "file=@/path/to/form-template.pdf"
```

### 7. Manual seed (admin, run if options are missing)

```bash
curl -X POST http://localhost:3000/api/development-options/seed \
  -H "Authorization: Bearer <TOKEN>"
```

---

## 🎨 Frontend Requirements

### Employee View — Token Request Page

**Layout**: 3 cards displayed in a row (or responsive grid), one per development option type.

Each card must show:

- [ ] **Option name** (e.g. "Task Offloading")
- [ ] **Short description** below the name
- [ ] **Token cost badge** — gold/amber badge (e.g. "1 Token" or "2 Tokens"), positioned top-right of card or prominently near the title
- [ ] **"Download Blank Form"** button/link — only shown when `formTemplateUrl` is not null; opens S3 URL in new tab
- [ ] **"Request"** button — disabled if `isActive` is false
- [ ] **Feature bullet list** — render `rules.features` as a `<ul>` of `<li>` items below the description. Example output for Task Offloading:
  ```
  • 1 token per OTJ or special project
  • No consecutive-year repeat
  ```
- [ ] **"Download Blank Form"** and **"Upload option for Form Template"** rows are always shown as the last two bullets (handled separately — see below)

### Admin View — Development Options Settings Page

**Same 3 cards** as employee view, plus per card:

- [ ] **Active/Inactive chip/badge** indicator
- [ ] **"Edit" button** — opens an edit modal
- [ ] **"Toggle" button** (or toggle switch) — quick active/inactive flip without opening modal
- [ ] **"Upload Form Template"** button — opens file picker (accept: .pdf, .docx, .doc)
- [ ] Show current template filename if already uploaded

#### Edit Modal fields:

- [ ] Name (text input)
- [ ] Description (textarea)
- [ ] Token Cost (number input, min 1)
- [ ] Is Active (checkbox or toggle)
- [ ] Rules (read-only JSON display or per-type structured fields — see Phase 3 below)

### Shared Behavior

- [ ] On load, call `GET /development-options` (or `?all=true` for admin)
- [ ] Token costs must always be read from API — never hardcoded
- [ ] Show loading skeleton while fetching
- [ ] Show error state if API call fails

---

## 🚀 Implementation Steps

### Phase 1 — Read Options and Display Cards

1. Create a `developmentOptionsService` (or equivalent store/hook):
   - `getOptions(all?: boolean)` → calls `GET /development-options` or `?all=true`
   - `getOption(id: string)` → calls `GET /development-options/:id`

2. On page load, fetch all options and store in component state.

3. Render a 3-column responsive grid of cards. Map over the results and render each card based on `type`.

4. Apply gold/amber styling to the token cost badge (e.g. Tailwind: `bg-amber-100 text-amber-800 font-semibold`).

5. Render the feature bullet list from `rules.features`:

   ```tsx
   <ul className="mt-2 space-y-1">
     {option.rules.features.map((f, i) => (
       <li key={i} className="flex items-start gap-2 text-sm">
         <span>•</span>
         <span>{f}</span>
       </li>
     ))}
   </ul>
   ```

   Do **not** hardcode these strings — they come from the API and are admin-configurable.

6. After the `features` list, always show two more fixed rows on every card:
   - **Download Form Template** — `<a href={formTemplateUrl} target="_blank">` shown only when `formTemplateUrl !== null`; otherwise render as a disabled/greyed row
   - **Upload option for Form Template** — visible to admin only (see Phase 3)

7. Show "Download Blank Form" as an `<a href={formTemplateUrl} target="_blank">` — render only when `formTemplateUrl !== null`.

### Phase 2 — Admin Edit & Toggle

6. Wire an "Edit" button that opens a modal pre-populated with the option's current values.

7. On modal save, call `PATCH /development-options/:id` with only changed fields (partial update is supported).

8. Wire a "Toggle" button that calls `PATCH /development-options/:id/toggle`. Immediately update the local state optimistically or refetch after response.

9. After any mutation, refetch the full list to keep UI in sync.

### Phase 3 — Form Template Upload

10. Add an "Upload Form Template" file input (accept: `.pdf,.docx,.doc`) per card (admin only).

11. On file select, build a `FormData` object:

    ```typescript
    const form = new FormData();
    form.append('file', selectedFile);
    ```

12. Call `POST /development-options/:id/template` with `Content-Type: multipart/form-data` (do **not** set Content-Type manually — let the browser set the boundary).

13. On success, update the card to show the new `formTemplateFileName` and `formTemplateUrl`.

### Phase 4 — Guard by Role

14. Read the current user's `roles` array from the JWT/auth context.

15. Show Edit, Toggle, and Upload controls **only when** `roles.includes('admin')`.

16. When calling `GET /development-options`, pass `?all=true` only when `roles.includes('admin')` — this ensures inactive options are hidden from employees automatically.

---

## ✅ Success Criteria

### Must Have

- [ ] All 3 development option cards are displayed correctly with data from the API
- [ ] Token cost badge is visible and reflects the API value (not hardcoded)
- [ ] Admin can edit name, description, and token cost via the edit modal
- [ ] Admin can toggle active/inactive status
- [ ] Admin can upload a form template file
- [ ] "Download Blank Form" button/link appears only when a template exists
- [ ] Employees see only active options (`isActive: true`)

### Should Have

- [ ] Loading skeletons while options are being fetched
- [ ] Toast/snackbar confirmation after successful edit, toggle, or upload
- [ ] Error handling with user-friendly messages (e.g. "Failed to update option")
- [ ] File upload progress indicator
- [ ] Confirmation dialog before toggling an option to inactive (in case employees have pending requests)

### Nice to Have

- [ ] Animated card transitions when toggling active status
- [ ] Rules JSON displayed as human-readable structured fields in the edit modal (rather than raw JSON)
- [ ] Drag-and-drop file upload for form templates
- [ ] Preview of uploaded PDF/DOCX filename with a remove button
