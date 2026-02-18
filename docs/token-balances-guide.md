# 💰 Token Balances Module — Frontend Implementation Guide

## 📋 Project Brief

Implement the **My Tokens** page (employee's token wallet) and the **Token Management** admin view.

Every employee starts each calendar year with **6 tokens**. The frontend needs to:

1. Show the employee's remaining / allocated tokens for the current year
2. Show a year-by-year history (how many tokens were used per year)
3. Allow admins to initialize tokens for all employees at the start of a new year
4. Allow admins/approvers to look up any employee's balance

The token balance is a **summary** — the actual transaction log of where tokens were spent lives in `token_requests` (a separate module).

---

## 🌐 API Endpoints

Base URL: `http://localhost:3000/api`

All endpoints require `Authorization: Bearer <token>` header.

| Method | Endpoint                          | Purpose                                           | Auth Required          |
| ------ | --------------------------------- | ------------------------------------------------- | ---------------------- |
| `GET`  | `/token-balances/me`              | My balance for the **current year**               | Any authenticated user |
| `GET`  | `/token-balances/me/history`      | My balance for **all years**                      | Any authenticated user |
| `GET`  | `/token-balances/me/:year`        | My balance for a **specific year**                | Any authenticated user |
| `GET`  | `/token-balances`                 | All employees' balances for current year          | Admin only             |
| `GET`  | `/token-balances?year=2025`       | All employees' balances for a specific year       | Admin only             |
| `GET`  | `/token-balances/:userId`         | A specific employee's balance (current year)      | Admin / Approver       |
| `GET`  | `/token-balances/:userId/history` | A specific employee's balance history             | Admin / Approver       |
| `POST` | `/token-balances/initialize`      | Seed 6 tokens for all active employees for a year | Admin only             |

### ⚠️ Important Notes

- A balance row is **auto-created** (with 6 tokens) the first time `GET /token-balances/me` is called for a year — no separate seeding required for the current user
- `POST /token-balances/initialize` is for **bulk pre-seeding** at the start of a new year (admin action, run once per year)
- `remaining` is computed on the server as `allocated - used` — it is not stored in the DB
- Balances for previous years are **read-only** — only the TokenRequest approval flow modifies `used`
- `:userId` params are **UUIDs** — never use `employeeId` (e.g. GDC-001) as the path param

---

## 📦 Data Models

### `TokenBalance` (TypeScript Interface)

```typescript
// Response from GET /token-balances/me and GET /token-balances/me/:year
interface TokenBalance {
  id: string; // UUID
  userId: string; // UUID — owner of this balance
  year: number; // e.g. 2026
  allocated: number; // always 6 (per company policy)
  used: number; // incremented when requests are approved
  remaining: number; // computed: allocated - used
}
```

### `TokenBalanceWithEmployee` (Admin list response)

```typescript
// Response items from GET /token-balances
interface TokenBalanceWithEmployee extends TokenBalance {
  employee: {
    employeeId: string; // e.g. 'GDC-001'
    firstName: string;
    lastName: string;
    department: string;
  };
}
```

### `InitializeYearDto` (Request body for POST /token-balances/initialize)

```typescript
interface InitializeYearDto {
  year: number; // integer, min: 2020, max: 2100
}
```

---

## 🧪 curl Test Commands

Replace `<TOKEN>` with a valid JWT. Replace `<USER_ID>` with a real user UUID.

### 1. Get my balance for current year

```bash
curl -X GET http://localhost:3000/api/token-balances/me \
  -H "Authorization: Bearer <TOKEN>"
```

### 2. Get my full history (all years)

```bash
curl -X GET http://localhost:3000/api/token-balances/me/history \
  -H "Authorization: Bearer <TOKEN>"
```

### 3. Get my balance for a specific year

```bash
curl -X GET http://localhost:3000/api/token-balances/me/2025 \
  -H "Authorization: Bearer <TOKEN>"
```

### 4. Admin — get all employees' balances for current year

```bash
curl -X GET http://localhost:3000/api/token-balances \
  -H "Authorization: Bearer <TOKEN>"
```

### 5. Admin — get all employees' balances for a specific year

```bash
curl -X GET "http://localhost:3000/api/token-balances?year=2025" \
  -H "Authorization: Bearer <TOKEN>"
```

### 6. Admin/Approver — get a specific employee's balance

```bash
curl -X GET http://localhost:3000/api/token-balances/<USER_ID> \
  -H "Authorization: Bearer <TOKEN>"
```

### 7. Admin/Approver — get a specific employee's history

```bash
curl -X GET http://localhost:3000/api/token-balances/<USER_ID>/history \
  -H "Authorization: Bearer <TOKEN>"
```

### 8. Admin — initialize tokens for all active employees for a year

```bash
curl -X POST http://localhost:3000/api/token-balances/initialize \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{ "year": 2026 }'
```

---

## 🎨 Frontend Requirements

### Employee View — "My Tokens" Page

**Token counter widget** (shown in dashboard or dedicated page):

- [ ] Large display: **"X / 6 tokens remaining"** for the current year
- [ ] Progress bar or circular indicator showing `remaining / allocated`
- [ ] Color coding: green (4–6 remaining), amber (2–3), red (0–1)
- [ ] Sub-label: current year (e.g. "2026 Token Balance")

**Year history table/list** (below the counter):

- [ ] One row per year, ordered newest first
- [ ] Columns: Year | Allocated | Used | Remaining
- [ ] Highlight the current year row
- [ ] Show empty state if no history yet

### Admin View — Token Management Page

**Employee balance table**:

- [ ] Show all employees with columns: Employee ID | Name | Department | Allocated | Used | Remaining
- [ ] Year selector (dropdown/tabs) — defaults to current year, allows viewing past years
- [ ] Sort by remaining tokens (ascending) to identify employees running low
- [ ] Click a row to view that employee's year-by-year history

**Initialize Year button**:

- [ ] Button: "Initialize [Year] Tokens"
- [ ] Confirmation dialog: "This will create token balances for all active employees for [year]. Employees who already have a balance for this year will not be affected."
- [ ] On confirm: call `POST /token-balances/initialize` with `{ year }`
- [ ] Show result: "Created: X, Skipped (already had balance): Y"

### Shared Behavior

- [ ] Auto-fetch `GET /token-balances/me` on app load and cache it in auth/user context
- [ ] Display remaining token count in the top navigation bar or employee header
- [ ] Show loading skeleton while fetching
- [ ] Show error state if API call fails

---

## 🚀 Implementation Steps

### Phase 1 — Employee Token Counter

1. After login, call `GET /token-balances/me` and store the result in global state (context/store).

2. Display a token badge/counter in the app header or sidebar showing `remaining` out of `allocated`.

3. On the "My Tokens" page, render the full counter widget with progress indicator and the `remaining / allocated` fraction.

### Phase 2 — Year History

4. Call `GET /token-balances/me/history` to load all yearly records.

5. Render a table ordered by `year` descending:

   ```
   Year | Allocated | Used | Remaining
   2026 |     6     |  2   |     4      ← current year (highlighted)
   2025 |     6     |  5   |     1
   2024 |     6     |  6   |     0
   ```

6. Note: the "Used" column shows only the approved expenditure summary. For the full transaction detail (what each token was spent on), link to the Token Requests page filtered by that year.

### Phase 3 — Admin Balance Table

7. Call `GET /token-balances` (with optional `?year=YYYY`) to load all employee balances.

8. Render a sortable table. Add a year picker that re-fetches with `?year=` when changed.

9. Make each row clickable — clicking opens a side panel or page showing `GET /token-balances/:userId/history`.

### Phase 4 — Initialize Year (Admin)

10. Add an "Initialize Tokens" button visible only to admins.

11. Show a confirmation modal with the target year pre-filled to the current year (allow admin to change it).

12. On confirm, call `POST /token-balances/initialize` and display the `{ created, skipped }` result in a success toast:
    > "Done! 390 employees received their 6 tokens. 5 already had a balance and were skipped."

---

## ✅ Success Criteria

### Must Have

- [ ] Employee can see their remaining token balance for the current year
- [ ] Token balance is visible in the app header or navigation (quick reference)
- [ ] Employee can view their year-by-year history
- [ ] Admin can see all employee balances for the current year
- [ ] Admin can initialize tokens for a new year

### Should Have

- [ ] Year filter on the admin balance table
- [ ] Color-coded remaining balance (green/amber/red)
- [ ] Click-through from balance table to employee's history
- [ ] Success toast showing created/skipped count after initialization
- [ ] Confirmation dialog before bulk initialization

### Nice to Have

- [ ] Export admin table to CSV
- [ ] Search/filter by employee name or department in the admin table
- [ ] Link from history table row to the token requests for that year
