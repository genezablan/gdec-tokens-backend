# 🪙 Token Management Page — Frontend Implementation Guide

## 📋 Project Brief

Implement the **Token Management** page — an admin-only view that lists every employee's token
balance for the current year. Admins can adjust each employee's **boost tokens** using +/− controls
and export the full table to CSV.

---

## 🌐 API Endpoints

Base URL: `http://localhost:3000/api`

All endpoints require `Authorization: Bearer <token>` header.

| Method    | Endpoint                                   | Purpose                                                    | Auth Required |
| --------- | ------------------------------------------ | ---------------------------------------------------------- | ------------- |
| `GET`     | `/token-balances?year=<year>`              | List all employee balances for a year (defaults to current) | Admin         |
| `PATCH`   | `/token-balances/:userId/boost?year=<year>` | Set boost tokens for one employee (absolute value)         | Admin         |
| `GET`     | `/token-balances/export?year=<year>`       | Download all balances as CSV                               | Admin         |
| `POST`    | `/token-balances/initialize`               | Seed 6-token balances for all active employees             | Admin         |

---

## 📦 Data Models

### `EmployeeTokenRow` — shape of each row returned by `GET /token-balances`

```typescript
interface EmployeeTokenRow {
  id: string;           // TokenBalance UUID
  userId: string;       // User UUID
  year: number;
  allocated: number;    // Base allocation (always 6)
  boostTokens: number;  // Extra tokens granted by admin
  used: number;         // Tokens spent on approved requests
  remaining: number;    // allocated + boostTokens - used
  employee: {
    employeeId: string; // e.g. "GDC-001"
    firstName: string;
    lastName: string;
    department: string;
  };
}
```

### `UpdateBoostTokensDto` — body for `PATCH /token-balances/:userId/boost`

```typescript
interface UpdateBoostTokensDto {
  boostTokens: number; // integer >= 0, absolute value (not a delta)
}
```

---

## 🧪 curl Test Commands

Replace `<TOKEN>` with admin JWT and `<USER_ID>` with a real user UUID.

### 1. List all employee balances (current year)

```bash
curl -X GET http://localhost:3000/api/token-balances \
  -H "Authorization: Bearer <TOKEN>"
```

### 2. List balances for a specific year

```bash
curl -X GET "http://localhost:3000/api/token-balances?year=2025" \
  -H "Authorization: Bearer <TOKEN>"
```

### 3. Set boost tokens for one employee

```bash
curl -X PATCH http://localhost:3000/api/token-balances/<USER_ID>/boost \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{ "boostTokens": 2 }'
```

**Response:**
```json
{
  "id": "...",
  "userId": "...",
  "year": 2026,
  "allocated": 6,
  "boostTokens": 2,
  "used": 1,
  "remaining": 7
}
```

### 4. Export to CSV

```bash
curl -X GET "http://localhost:3000/api/token-balances/export?year=2026" \
  -H "Authorization: Bearer <TOKEN>" \
  -o token-balances-2026.csv
```

### 5. Initialize balances for a year

```bash
curl -X POST http://localhost:3000/api/token-balances/initialize \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{ "year": 2026 }'
```

**Response:**
```json
{ "created": 390, "skipped": 5 }
```

---

## 🎨 Frontend Requirements

### Layout

The page mirrors the screenshot:

- Page title: **Token Management** with a back arrow and breadcrumb `Overview / Token Management`
- A toolbar row: **Sort: Alphabetically** dropdown on the left side, **Export to CSV** button (blue, with download icon) on the right
- A full-width data table with one row per employee, sorted A–Z by last name by default

### Table Columns

| Column               | Source field                       | Notes                                              |
| -------------------- | ---------------------------------- | -------------------------------------------------- |
| Name of Employee     | `employee.firstName + lastName`    | Full name, plain text                              |
| Department           | `employee.department`              | Greyed/muted text style                            |
| Based allocation     | `allocated`                        | Numeric, centered                                  |
| Available token      | `remaining`                        | Numeric, centered                                  |
| Used token           | `used`                             | Numeric, centered                                  |
| Boost token          | `boostTokens`                      | Inline +/− stepper (see below)                     |

### Boost Token Stepper

Each row in the **Boost token** column shows:

```
[−]  <value>  [+]
```

- The value starts at the current `boostTokens` for that employee
- **[−]** decrements by 1 (minimum 0); **[+]** increments by 1
- On each click, immediately call `PATCH /token-balances/:userId/boost` with the new absolute value
- After a successful response, update `boostTokens` and `remaining` locally from the response (no full reload needed)
- Disable **[−]** when `boostTokens === 0`
- Show a loading state on the stepper while the request is in flight

### Sort Dropdown

- Options: **Alphabetically** (A–Z by `lastName`), **By Department**, **Most Used**, **Least Available**
- Sorting is client-side on the already-fetched data

### Export to CSV

On click of **Export to CSV**:
1. Call `GET /token-balances/export?year=<currentYear>`
2. The backend returns a `text/csv` file — trigger a browser download:
   ```typescript
   const blob = new Blob([csvText], { type: 'text/csv' });
   const url = URL.createObjectURL(blob);
   const a = document.createElement('a');
   a.href = url;
   a.download = `token-balances-${year}.csv`;
   a.click();
   URL.revokeObjectURL(url);
   ```

---

## 🚀 Implementation Steps

### Phase 1 — Fetch and Display the Table

1. On mount, call `GET /token-balances` (no year param → uses current year server-side).
2. Store the result array in component state as `rows: EmployeeTokenRow[]`.
3. Render the table sorted alphabetically (A–Z by `lastName`) as the default.
4. Display a loading skeleton (e.g. 5–8 grey shimmer rows) while fetching.
5. Show an error banner if the request fails.

### Phase 2 — Boost Token Stepper

6. For each row, render a stepper:
   ```tsx
   <div className="flex items-center gap-2">
     <button
       onClick={() => handleBoostChange(row.userId, row.boostTokens - 1)}
       disabled={row.boostTokens === 0 || isUpdating[row.userId]}
       className="w-8 h-8 rounded-full bg-black text-white flex items-center justify-center"
     >
       −
     </button>
     <span className="w-4 text-center">{row.boostTokens}</span>
     <button
       onClick={() => handleBoostChange(row.userId, row.boostTokens + 1)}
       disabled={isUpdating[row.userId]}
       className="w-8 h-8 rounded-full bg-black text-white flex items-center justify-center"
     >
       +
     </button>
   </div>
   ```

7. Implement `handleBoostChange(userId, newValue)`:
   ```typescript
   async function handleBoostChange(userId: string, newValue: number) {
     if (newValue < 0) return;
     setIsUpdating((prev) => ({ ...prev, [userId]: true }));
     try {
       const updated = await patchBoostTokens(userId, newValue); // PATCH /token-balances/:userId/boost
       setRows((prev) =>
         prev.map((r) =>
           r.userId === userId
             ? { ...r, boostTokens: updated.boostTokens, remaining: updated.remaining }
             : r,
         ),
       );
     } finally {
       setIsUpdating((prev) => ({ ...prev, [userId]: false }));
     }
   }
   ```

### Phase 3 — Sort and Export

8. Implement the Sort dropdown with client-side sorting:
   ```typescript
   const sorted = [...rows].sort((a, b) => {
     if (sortBy === 'alphabetically') return a.employee.lastName.localeCompare(b.employee.lastName);
     if (sortBy === 'department') return a.employee.department.localeCompare(b.employee.department);
     if (sortBy === 'mostUsed') return b.used - a.used;
     if (sortBy === 'leastAvailable') return a.remaining - b.remaining;
     return 0;
   });
   ```

9. Implement the Export to CSV button using the browser-download snippet in the requirements above.

---

## ✅ Success Criteria

### Must Have

- [ ] Table loads with all employees, their department, base allocation, available tokens, used tokens, and boost tokens
- [ ] Boost token +/− stepper works per row and persists to the backend
- [ ] Stepper is disabled (minimum 0) when boost is 0 and [−] is clicked
- [ ] Export to CSV downloads a valid `.csv` file
- [ ] Sort alphabetically is the default view

### Should Have

- [ ] Loading skeleton while fetching
- [ ] Individual row loading state while boost update is in flight
- [ ] Toast confirmation after boost token update
- [ ] Sort dropdown with at least Alphabetically and By Department options

### Nice to Have

- [ ] Year selector (defaults to current year; admin can switch to view past years)
- [ ] Search/filter by employee name or department
- [ ] Highlight rows where `remaining === 0` (employee has spent all tokens)
