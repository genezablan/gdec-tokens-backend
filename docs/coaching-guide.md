# 📋 Internal Coaching — Frontend Implementation Guide

> **Parent guide:** [Token Requests — Shared Guide](./token-requests-guide.md)

## 📋 Brief

**Internal Coaching** pairs an employee with a certified internal coach for a 3-session development cycle.

| Field        | Value                                                                                                                 |
| ------------ | --------------------------------------------------------------------------------------------------------------------- |
| Token cost   | **2 tokens** (fixed, configured in `development_options`)                                                             |
| Sessions     | Exactly **3 sessions** per approved request, with the same coach                                                      |
| Session flow | HR approves → employee or coach books sessions from coach's availability calendar → coach marks each session complete |
| Who can book | The employee **or** the assigned coach can book/cancel sessions                                                       |

---

## 🌐 API Endpoints

Base URL: `http://localhost:3000/api`

### Submission

| Method | Endpoint                   | Purpose                   | Auth Required          |
| ------ | -------------------------- | ------------------------- | ---------------------- |
| `POST` | `/token-requests/coaching` | Submit a Coaching request | Any authenticated user |

### Coach Availability

| Method   | Endpoint                             | Purpose                                    | Auth Required          |
| -------- | ------------------------------------ | ------------------------------------------ | ---------------------- |
| `POST`   | `/coach-availability`                | Coach adds an available time slot          | `coach` or `admin`     |
| `GET`    | `/coach-availability/my`             | Coach views their own upcoming slots       | `coach` or `admin`     |
| `GET`    | `/coach-availability/:coachId`       | View a coach's unbooked available slots    | Any authenticated user |
| `DELETE` | `/coach-availability/:id`            | Coach removes an unbooked slot             | `coach` or `admin`     |
| `PATCH`  | `/coach-availability/:id/deactivate` | Coach soft-disables a slot (keeps history) | `coach` or `admin`     |

### Sessions (nested under the token request)

| Method   | Endpoint                                     | Purpose                                             | Auth Required              |
| -------- | -------------------------------------------- | --------------------------------------------------- | -------------------------- |
| `GET`    | `/token-requests/:id/sessions`               | List all sessions for a coaching request            | Any authenticated user     |
| `POST`   | `/token-requests/:id/sessions`               | Book the next session from an availability slot     | Employee or assigned coach |
| `PATCH`  | `/token-requests/:id/sessions/:sid/complete` | Coach marks session completed (with optional notes) | `coach` or `admin`         |
| `PATCH`  | `/token-requests/:id/sessions/:sid/no-show`  | Coach marks employee as no-show                     | `coach` or `admin`         |
| `DELETE` | `/token-requests/:id/sessions/:sid`          | Cancel a scheduled session (releases slot)          | Employee or assigned coach |

Shared endpoints (cancel request, resubmit, approve/reject, view) are in [token-requests-guide.md](./token-requests-guide.md).

---

## 📦 Data Models

### Request Body — Submit

```typescript
interface CreateCoachingRequestDto {
  developmentOptionId: string; // UUID of the coaching development option
  coachId: string; // UUID of a user with the `coach` role
  notes?: string; // Optional coaching goals
  attachmentUrl?: string; // Optional supporting document
}
```

### `formData` on the saved request

```typescript
interface CoachingFormData {
  coachId: string;
  coachName: string; // Snapshot of coach's full name at submission time
  notes: string | null;
}
```

### `ResubmitTokenRequestDto` (coaching fields only)

```typescript
interface ResubmitCoachingDto {
  coachId?: string; // Replace the coach (must have coach role)
  notes?: string; // Update coaching notes
  attachmentUrl?: string; // Replace the supporting document
}
```

### `CoachAvailability`

```typescript
interface CoachAvailability {
  id: string; // UUID
  coachId: string;
  availableDate: string; // "YYYY-MM-DD"
  startTime: string; // "HH:MM" (24-hour)
  endTime: string; // "HH:MM" (24-hour)
  isBooked: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
```

### `CreateAvailabilitySlotDto` (body for `POST /coach-availability`)

```typescript
interface CreateAvailabilitySlotDto {
  availableDate: string; // "YYYY-MM-DD" — must be today or future
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM" — must be after startTime
}
```

### `CoachingSession`

```typescript
interface CoachingSession {
  id: string; // UUID
  tokenRequestId: string;
  coachId: string;
  coach: { id: string; firstName: string; lastName: string };
  employeeId: string;
  employee: { id: string; firstName: string; lastName: string };
  availabilityId: string | null; // FK to the booked availability slot
  availability: CoachAvailability | null;
  sessionNumber: 1 | 2 | 3;
  scheduledAt: string; // ISO 8601 timestamp
  status: CoachingSessionStatus;
  completedAt: string | null;
  sessionNotes: string | null;
  createdAt: string;
  updatedAt: string;
}
```

### `BookSessionDto` (body for `POST /token-requests/:id/sessions`)

```typescript
interface BookSessionDto {
  availabilityId: string; // UUID of the coach's availability slot to book
}
```

### `CompleteSessionDto` (body for `PATCH /sessions/:sid/complete`)

```typescript
interface CompleteSessionDto {
  notes?: string; // Optional post-session notes from the coach
}
```

### Enums

```typescript
enum CoachingSessionStatus {
  SCHEDULED = 'scheduled',
  COMPLETED = 'completed',
  NO_SHOW = 'no_show',
  CANCELLED = 'cancelled',
}
```

---

## 🔄 End-to-End Workflow

```
Employee submits coaching request
          ↓
   status: pending
          ↓ (manager approves)
   status: manager_approved
          ↓ (HR approves — 2 tokens deducted)
   status: approved
          ↓
Employee or coach views coach's availability (GET /coach-availability/:coachId)
and books Session 1 (POST /sessions) → sessionNumber: 1, status: scheduled
          ↓ (session takes place)
Coach marks Session 1 complete (PATCH /sessions/:sid/complete)
          ↓
Book Session 2, complete, then Session 3
          ↓
All 3 sessions completed ✓
```

Slots marked as `isBooked = true` are hidden from the availability calendar automatically.
If a session is cancelled or marked no-show, the slot is **released** and can be re-booked.

---

## 🧪 curl Test Commands

Replace `<TOKEN>` with a JWT. Replace `<ID>` / `<SID>` / `<COACH_ID>` with real UUIDs.

### 1. Get coaches

```bash
curl "http://localhost:3000/api/users?role=coach" \
  -H "Authorization: Bearer <TOKEN>"
```

### 2. Submit a Coaching request

```bash
curl -X POST http://localhost:3000/api/token-requests/coaching \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "developmentOptionId": "<OPTION_UUID>",
    "coachId": "<COACH_UUID>",
    "notes": "Improve leadership and public speaking skills."
  }'
```

### 3. Coach: add an availability slot

```bash
curl -X POST http://localhost:3000/api/coach-availability \
  -H "Authorization: Bearer <COACH_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "availableDate": "2026-03-10",
    "startTime": "14:00",
    "endTime": "15:00"
  }'
```

### 4. Coach: view own slots

```bash
curl http://localhost:3000/api/coach-availability/my \
  -H "Authorization: Bearer <COACH_TOKEN>"
```

### 5. Employee: view a coach's available slots

```bash
curl http://localhost:3000/api/coach-availability/<COACH_ID> \
  -H "Authorization: Bearer <TOKEN>"
```

### 6. Book Session 1

```bash
curl -X POST http://localhost:3000/api/token-requests/<ID>/sessions \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{ "availabilityId": "<SLOT_UUID>" }'
```

### 7. View all sessions for a request

```bash
curl http://localhost:3000/api/token-requests/<ID>/sessions \
  -H "Authorization: Bearer <TOKEN>"
```

### 8. Coach: mark session complete

```bash
curl -X PATCH http://localhost:3000/api/token-requests/<ID>/sessions/<SID>/complete \
  -H "Authorization: Bearer <COACH_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{ "notes": "Strong progress on active listening skills." }'
```

### 9. Coach: mark session no-show

```bash
curl -X PATCH http://localhost:3000/api/token-requests/<ID>/sessions/<SID>/no-show \
  -H "Authorization: Bearer <COACH_TOKEN>"
```

### 10. Cancel a session

```bash
curl -X DELETE http://localhost:3000/api/token-requests/<ID>/sessions/<SID> \
  -H "Authorization: Bearer <TOKEN>"
```

### 11. Coach: remove an unbooked slot

```bash
curl -X DELETE http://localhost:3000/api/coach-availability/<SLOT_ID> \
  -H "Authorization: Bearer <COACH_TOKEN>"
```

### 12. Coach: deactivate a slot without deleting

```bash
curl -X PATCH http://localhost:3000/api/coach-availability/<SLOT_ID>/deactivate \
  -H "Authorization: Bearer <COACH_TOKEN>"
```

---

## 🎨 Frontend Requirements

### Employee — Coaching Request Form Modal

```
Employee Information (read-only — auto-filled)
────────────────────────────────────────────────
Department:  [ Finance ]   Position: [ Finance Officer ]
Manager:     [ Juan dela Cruz ]   Date: [ Feb 19, 2026 ]
Tokens:      [ 2 tokens ]

Select Coach *
──────────────
[ Search or pick from dropdown... ]   ← GET /users?role=coach
  Shows: full name, position, department

Coaching Goals (optional)
──────────────────────────
[ textarea ]

Supporting Document (optional)
────────────────────────────────
[ 📎 Choose file... ]
```

- Populate the coach dropdown from `GET /users?role=coach`.
- On coach selection, optionally show a preview of their available sessions
  (`GET /coach-availability/:coachId`) to help the employee choose.

---

### Coach — Availability Calendar

A calendar page/tab visible only to users with the `coach` role.

#### Adding Slots

- Date picker + time range inputs (start/end)
- On submit → `POST /coach-availability`
- Validation: date must be today or future, endTime must be after startTime

#### Viewing My Slots

- Fetch `GET /coach-availability/my` and render as a calendar or list
- Show `isBooked` status on each slot (booked slots are greyed out)
- **Delete** button on unbooked slots → `DELETE /coach-availability/:id`
- **Deactivate** button → `PATCH /coach-availability/:id/deactivate`

---

### Session Tracking Page

Visible to the employee and the assigned coach after `status === 'approved'`.

Show a stepper / progress tracker with 3 steps:

```
Session 1  [✓ Completed]  Mar 10, 2026 2:00 PM – 3:00 PM
Session 2  [📅 Scheduled] Mar 17, 2026 2:00 PM – 3:00 PM     [Cancel]
Session 3  [+ Book Now]
```

#### Behaviour

| Session status | Employee sees                           | Coach sees                                |
| -------------- | --------------------------------------- | ----------------------------------------- |
| Not booked     | **Book** button → opens slot picker     | **Book** button → opens slot picker       |
| `scheduled`    | `Cancel` button                         | `Mark Complete`, `Mark No-show`, `Cancel` |
| `completed`    | Completion date + coach notes           | Completion date + notes                   |
| `no_show`      | No-show badge                           | No-show badge                             |
| `cancelled`    | Cancelled badge + **Book** again button | Cancelled badge + **Book** again button   |

#### Slot Picker Modal

- Fetch `GET /coach-availability/:coachId` (returns only unbooked, active, future slots)
- Display as list of date/time options
- On confirm → `POST /:id/sessions` with `{ availabilityId }`

#### Complete Session Modal (coach only)

- Optional notes textarea
- On confirm → `PATCH /:id/sessions/:sid/complete` with `{ notes? }`

---

## ✅ Success Criteria

### Must Have

- [ ] Employee can select a coach with the `coach` role when submitting
- [ ] Coaching request is submitted with `coachId` and optional notes
- [ ] Coach can add, view, and delete availability slots
- [ ] After HR approval, employee or coach can book sessions from available slots
- [ ] Booked slot is marked unavailable and hidden from the availability picker
- [ ] Coach can mark sessions as `completed` or `no_show`
- [ ] Cancelled/no-show sessions release the slot so it can be rebooked
- [ ] Session progress (1/3, 2/3, 3/3) is visible to both parties

### Should Have

- [ ] Session booking confirmation email/notification
- [ ] Slot picker shows date, time, and duration clearly
- [ ] Session notes visible in session detail
- [ ] Completion date shown on completed sessions

### Nice to Have

- [ ] Calendar view (monthly) for coach availability management
- [ ] iCal / Google Calendar export link for booked sessions
- [ ] Dashboard summary: completed vs. remaining sessions per coaching request
