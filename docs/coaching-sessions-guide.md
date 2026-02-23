# 🎓 Frontend Implementation Guide: Coaching Sessions

## 📋 Project Brief

Implement the **Coaching Sessions** feature for the GDEC Tokens system. After an internal coaching token request is **fully approved** (status = `approved`), the employee and assigned coach schedule and track up to **3 sessions** within the coaching cycle.

There are two sub-systems:

1. **Coach Availability** — coaches publish time slots; employees browse and book them.
2. **Coaching Sessions** — the actual 1-of-3 session records tied to a token request.

---

## 🎯 Backend API Endpoints

### Coach Availability

**Base URL:** `http://localhost:3000/api/coach-availability`

| Method   | Endpoint                             | Purpose                                   | Auth Required     |
| -------- | ------------------------------------ | ----------------------------------------- | ----------------- |
| `POST`   | `/coach-availability`                | Coach adds a new time slot                | Yes — coach/admin |
| `GET`    | `/coach-availability/my`             | Coach views their own future slots        | Yes — coach/admin |
| `GET`    | `/coach-availability/:coachId`       | View a coach's available (unbooked) slots | Yes — any role    |
| `DELETE` | `/coach-availability/:id`            | Coach deletes an unbooked slot            | Yes — coach/admin |
| `PATCH`  | `/coach-availability/:id/deactivate` | Coach soft-disables a slot                | Yes — coach/admin |

### Coaching Sessions

**Base URL:** `http://localhost:3000/api/token-requests/:id/sessions`

| Method   | Endpoint                                     | Purpose                                                               | Auth Required           |
| -------- | -------------------------------------------- | --------------------------------------------------------------------- | ----------------------- |
| `GET`    | `/token-requests/:id/sessions`               | List all sessions for a coaching request                              | Yes — any role          |
| `GET`    | `/token-requests/coaching/my-overview`       | Coach: all their assigned requests + sessions embedded                | Yes — coach/admin       |
| `POST`   | `/token-requests/:id/sessions`               | Employee books next session → status becomes `pending_coach_approval` | Yes — employee or coach |
| `PATCH`  | `/token-requests/:id/sessions/:sid/confirm`  | Coach confirms the booking → status becomes `scheduled`               | Yes — coach/admin       |
| `PATCH`  | `/token-requests/:id/sessions/:sid/decline`  | Coach declines the booking → slot released, employee can rebook       | Yes — coach/admin       |
| `PATCH`  | `/token-requests/:id/sessions/:sid/complete` | Coach marks a scheduled session as completed                          | Yes — coach/admin       |
| `PATCH`  | `/token-requests/:id/sessions/:sid/no-show`  | Coach marks employee as no-show                                       | Yes — coach/admin       |
| `DELETE` | `/token-requests/:id/sessions/:sid`          | Cancel a session (pending or scheduled)                               | Yes — employee or coach |

---

## ⚠️ Important Notes

- Sessions can only be booked when the parent token request has `status = approved`.
- A coaching cycle has exactly **3 sessions**. Booking is sequential: session 1 must be confirmed before session 2 can be booked.
- The `coachId` used for session booking comes from `tokenRequest.formData.coachId` — it is set at request creation time and cannot change after approval.
- **Session booking requires coach approval.** When an employee books a slot, the session starts as `pending_coach_approval`. The coach must explicitly confirm it before it becomes `scheduled`.
- If the coach **declines**, the availability slot is released and the employee can pick a different slot and rebook.
- Cancelled and declined sessions are excluded from the session count — numbering always reflects active sessions.
- When a session is **cancelled** or marked **no-show**, the underlying availability slot is automatically released and becomes bookable again.
- Only the assigned coach's slots can be booked for a given coaching request — slots from other coaches are rejected.
- Slots in the past are rejected at booking time.
- Duplicate slots (same coach, same date, same `startTime`) are rejected when the coach tries to add them.

---

## 📝 Data Models

### CoachAvailability

```typescript
interface CoachAvailability {
  id: string; // UUID
  coachId: string; // UUID of the coach (User)
  coach?: User; // Populated on some responses
  availableDate: string; // "YYYY-MM-DD"
  startTime: string; // "HH:MM:SS" (24-hour, pg returns with seconds)
  endTime: string; // "HH:MM:SS" (24-hour)
  isBooked: boolean; // true once a session is scheduled against this slot
  isActive: boolean; // false if coach deactivated the slot
  createdAt: string;
  updatedAt: string;
}
```

### CoachingSession

```typescript
interface CoachingSession {
  id: string; // UUID
  tokenRequestId: string; // UUID of the parent TokenRequest
  coachId: string; // UUID
  coach?: User;
  employeeId: string; // UUID
  employee?: User;
  availabilityId: string | null;
  availability?: CoachAvailability | null;
  sessionNumber: number; // 1, 2, or 3
  scheduledAt: string; // ISO timestamp
  status: CoachingSessionStatus;
  completedAt: string | null;
  sessionNotes: string | null;
  createdAt: string;
  updatedAt: string;
}
```

### Enums

```typescript
enum CoachingSessionStatus {
  PENDING_COACH_APPROVAL = 'pending_coach_approval', // Booked by employee, awaiting coach confirmation
  SCHEDULED = 'scheduled', // Coach confirmed — session is locked in
  COMPLETED = 'completed', // Coach marked the session as done
  NO_SHOW = 'no_show', // Employee did not attend
  CANCELLED = 'cancelled', // Cancelled by employee or coach
  DECLINED = 'declined', // Coach declined the booking request
}
```

---

## 🌐 curl Test Commands

### Coach Availability

```bash
# Add a slot
curl -X POST http://localhost:3000/api/coach-availability \
  -H "Authorization: Bearer <coach_token>" \
  -H "Content-Type: application/json" \
  -d '{"availableDate":"2026-03-10","startTime":"09:00","endTime":"10:00"}'

# View my slots (coach)
curl http://localhost:3000/api/coach-availability/my \
  -H "Authorization: Bearer <coach_token>"

# View a coach's available slots (employee picking a slot)
curl http://localhost:3000/api/coach-availability/<coachId> \
  -H "Authorization: Bearer <employee_token>"

# Delete a slot
curl -X DELETE http://localhost:3000/api/coach-availability/<slotId> \
  -H "Authorization: Bearer <coach_token>"

# Deactivate a slot
curl -X PATCH http://localhost:3000/api/coach-availability/<slotId>/deactivate \
  -H "Authorization: Bearer <coach_token>"
```

### Coaching Sessions

```bash
# Coach: get all assigned requests with sessions embedded (powers My Sessions page)
curl http://localhost:3000/api/token-requests/coaching/my-overview \
  -H "Authorization: Bearer <coach_token>"

# Book next session (employee) → creates session with status: pending_coach_approval
curl -X POST http://localhost:3000/api/token-requests/<requestId>/sessions \
  -H "Authorization: Bearer <employee_or_coach_token>" \
  -H "Content-Type: application/json" \
  -d '{"availabilityId":"<slotId>"}'

# List all sessions for a request
curl http://localhost:3000/api/token-requests/<requestId>/sessions \
  -H "Authorization: Bearer <token>"

# Confirm session (coach) → status becomes scheduled
curl -X PATCH http://localhost:3000/api/token-requests/<requestId>/sessions/<sessionId>/confirm \
  -H "Authorization: Bearer <coach_token>"

# Decline session (coach) → status becomes declined, slot released
curl -X PATCH http://localhost:3000/api/token-requests/<requestId>/sessions/<sessionId>/decline \
  -H "Authorization: Bearer <coach_token>"

# Mark session complete (coach)
curl -X PATCH http://localhost:3000/api/token-requests/<requestId>/sessions/<sessionId>/complete \
  -H "Authorization: Bearer <coach_token>" \
  -H "Content-Type: application/json" \
  -d '{"notes":"Covered leadership fundamentals and goal setting."}'

# Mark no-show (coach)
curl -X PATCH http://localhost:3000/api/token-requests/<requestId>/sessions/<sessionId>/no-show \
  -H "Authorization: Bearer <coach_token>"

# Cancel session (employee or coach) — works on pending_coach_approval or scheduled
curl -X DELETE http://localhost:3000/api/token-requests/<requestId>/sessions/<sessionId> \
  -H "Authorization: Bearer <token>"
```

---

## 🖥️ Frontend Requirements

### Employee View — inside Request Detail page (`/requests/:id`)

Only shown when the request `type === 'coaching'` and `status === 'approved'`.

#### Session Timeline Component

- Display 3 session slots (even if not yet booked) labelled **Session 1**, **Session 2**, **Session 3**.
- For each booked session show:
  - `scheduledAt` formatted as a readable date/time (e.g. "March 10, 2026 · 9:00 AM")
  - Status badge: `Pending Approval` (yellow) / `Scheduled` (blue) / `Completed` (green) / `Cancelled` (grey) / `No-show` (orange) / `Declined` (red)
  - If `status === 'pending_coach_approval'`: show "Awaiting coach confirmation" info message + **Cancel** button.
  - If `status === 'scheduled'`: show **Cancel** button.
  - If `status === 'declined'`: show "Coach declined — please book a new slot" warning + re-enable the **Book Session** button for this slot number.
  - If `status === 'completed'` and `sessionNotes` exists, show the notes.
- For each unbooked slot, show a **Book Session** button. Disable it if the **previous** session is still `pending_coach_approval` (employee must wait for coach to confirm before booking the next one).

#### Book Session Modal

- Triggered by the **Book Session** button.
- Fetches available slots from `GET /coach-availability/<coachId>`.
  - The `coachId` is found in `tokenRequest.formData.coachId`.
- Displays slots grouped by date in a calendar/list picker.
- Each slot shows `startTime – endTime`.
- On confirm: `POST /token-requests/:id/sessions` with `{ availabilityId }`.
- On success: refresh the session list, close modal.

---

### Coach View — dedicated page (`/coach/sessions`)

#### How the coach sees bookings

The coach calls a **single endpoint** that returns all their assigned coaching requests with sessions already embedded:

```
GET /api/token-requests/coaching/my-overview
Authorization: Bearer <coach_token>
```

Each item in the response is a `TokenRequest` with an extra `sessions: CoachingSession[]` field.
The coach's page uses this to render the full list without making per-request follow-up calls.

**Response shape:**

```typescript
[
  {
    id: string,
    type: 'coaching',
    status: 'pending' | 'manager_approved' | 'approved',
    employee: { id, firstName, lastName, ... },
    createdAt: string,
    // ...other TokenRequest fields...
    sessions: [
      {
        id: string,
        sessionNumber: 1,
        scheduledAt: string,
        status: 'pending_coach_approval' | 'scheduled' | 'completed' | ...,
        sessionNotes: string | null,
        availability: { availableDate, startTime, endTime } | null,
      },
      // ...
    ]
  },
  // ...
]
```

#### My Sessions Table

- Call `GET /token-requests/coaching/my-overview` on page load.
- Group requests by status: show **action-required** items (those with any session in `pending_coach_approval`) at the top.
- For each request, show a collapsible row expanding to its session list.
- Columns: Employee Name, Session #, Date/Time, Status, Actions.
- Actions per row:
  - `status === 'pending_coach_approval'`: **Confirm** button (→ `PATCH .../confirm`) + **Decline** button (→ `PATCH .../decline`).
  - `status === 'scheduled'`: **Mark Complete** button + optional notes textarea, **Mark No-show** button.
  - `status === 'completed'` / `cancelled` / `no_show` / `declined`: read-only.
- Show a badge or count in the page title/nav for how many sessions are awaiting confirmation.

#### My Availability Page (`/coach/availability`)

- Fetch coach's own slots: `GET /coach-availability/my`.
- Display as a list or calendar grid grouped by date.
- Each slot shows: Date, Start–End time, `Booked` / `Available` badge.
- **Add Slot** form: date picker (YYYY-MM-DD), start time (HH:MM), end time (HH:MM).
  - Validate locally: start < end, date not in past.
  - Submit: `POST /coach-availability`.
- **Delete** button for unbooked slots. **Deactivate** button as an alternative.

---

### Admin View — inside Request Detail page (`/admin/requests/:id`)

- Read-only session timeline (same component as employee view, without action buttons).
- Shows all 3 session slots with statuses, scheduled times, and coach notes.

---

## 🏗️ Implementation Steps

### Phase 1 — Coach Availability Management

1. Create `CoachAvailability` TypeScript interfaces and enums.
2. Build the `CoachAvailabilityService` with API calls for `addSlot`, `getMySlots`, `getAvailableForCoach`, `deleteSlot`, `deactivateSlot`.
3. Build the `/coach/availability` page.
4. Build the **Add Slot** form with validation.
5. Display slot list with delete/deactivate actions.

### Phase 2 — Session Booking (Employee)

1. Create `CoachingSession` TypeScript interfaces.
2. Build the `CoachingSessionsService` with API calls: `getSessions`, `bookSession`, `cancelSession`.
3. Build the **Session Timeline** component (3-slot display, status badges).
4. Build the **Book Session Modal** with slot picker (fetches from `/coach-availability/:coachId`).
5. Integrate into the existing Request Detail page (show only when `type === 'coaching'` and `status === 'approved'`).

### Phase 3 — Session Management (Coach)

1. Call `GET /token-requests/coaching/my-overview` to load all assigned coaching requests with sessions embedded — this is the single data source for the `/coach/sessions` page.
2. Build the `/coach/sessions` page with collapsible rows per request. Surface requests with `pending_coach_approval` sessions at the top.
3. Add **Confirm** action calling `PATCH .../confirm` for `pending_coach_approval` sessions.
4. Add **Decline** action calling `PATCH .../decline` — display a confirmation dialog first.
5. Add **Mark Complete** action (with notes textarea) calling `PATCH .../complete`.
6. Add **Mark No-show** action calling `PATCH .../no-show`.

### Phase 4 — Admin Read-Only View

1. Reuse the Session Timeline component (read-only mode prop).
2. Embed in admin request detail page.

---

## 📧 Email Notifications

All session email notifications are sent automatically by the backend — no frontend integration required to trigger them. The frontend may display toast/in-app messages for the current user's own actions.

| Trigger                                        | Recipient    | Subject                                                 |
| ---------------------------------------------- | ------------ | ------------------------------------------------------- |
| Employee books a session (`POST .../sessions`) | **Coach**    | `Session Booking Request — <Employee> (Session N)`      |
| Coach confirms (`PATCH .../confirm`)           | **Employee** | `Coaching Session Confirmed — Session N`                |
| Coach declines (`PATCH .../decline`)           | **Employee** | `Coaching Session Declined — Please Rebook (Session N)` |
| Coach marks complete (`PATCH .../complete`)    | **Employee** | `Session N Completed — Great Job!`                      |
| Coach marks no-show (`PATCH .../no-show`)      | **Employee** | `Coaching Session No-Show Recorded — Session N`         |

> The booking request notification to the coach replaces any need for the coach to actively poll for new bookings — they will be emailed immediately.

---

## 🔔 In-App (SSE) Notifications

In addition to emails, the backend also fires real-time in-app notifications via Server-Sent Events through the existing `NotificationsService`. These appear in the notification bell/drawer used across the rest of the application.

The frontend subscribes to `GET /api/notifications/stream` (SSE) to receive live pushes. Up to 10 unread notifications are replayed on reconnect.

### Notification Events

| Trigger                                        | Recipient    | Title                      | Type      |
| ---------------------------------------------- | ------------ | -------------------------- | --------- |
| Employee books a session (`POST .../sessions`) | **Coach**    | `Session Booking Request`  | `INFO`    |
| Coach confirms (`PATCH .../confirm`)           | **Employee** | `Session Confirmed`        | `SUCCESS` |
| Coach declines (`PATCH .../decline`)           | **Employee** | `Session Booking Declined` | `WARNING` |
| Coach marks complete (`PATCH .../complete`)    | **Employee** | `Session Completed`        | `SUCCESS` |
| Coach marks no-show (`PATCH .../no-show`)      | **Employee** | `Session No-Show Recorded` | `WARNING` |

All notifications include the `requestId` so the frontend can deep-link the user to the relevant coaching request detail page.

### Notification Response Shape

```typescript
interface Notification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
  requestId: string | null; // The coaching token request ID
  isRead: boolean;
  createdAt: string;
}
```

### Frontend Integration

1. **`GET /api/notifications/stream`** — subscribe on app load (SSE, `EventSource`).
2. **`GET /api/notifications`** — fetch unread count + list on initial load.
3. **`PATCH /api/notifications/:id/read`** — mark individual notification as read.
4. When `requestId` is present, clicking the notification navigates to the coaching request detail.

---

## ✅ Success Criteria

### Must Have

- [ ] Coach can add/delete/deactivate availability slots.
- [ ] Employee can see a coach's available slots and book the next session.
- [ ] Booked session starts as `pending_coach_approval` — employee sees "Awaiting coach confirmation" state.
- [ ] Coach can **confirm** a pending session → becomes `scheduled`.
- [ ] Coach can **decline** a pending session → slot released, employee can rebook.
- [ ] Session timeline shows all 3 slots with correct status badges.
- [ ] Employee can cancel a `pending_coach_approval` or `scheduled` session.
- [ ] Coach can mark a `scheduled` session as completed (with optional notes).
- [ ] Coach can mark a `scheduled` session as no-show.
- [ ] Completed sessions display coach's notes.
- [ ] Declined / cancelled / no-show slots are released and become bookable again.

### Should Have

- [ ] Booking is sequential — **Book Session 2** is only enabled after Session 1 is `scheduled` (confirmed).
- [ ] Slot picker is grouped by date and clearly shows time ranges.
- [ ] Past slots are filtered out in the booking modal.
- [ ] Loading and error states on all async actions.

### Nice to Have

- [ ] Calendar view for coach availability management.
- [ ] Confirmation dialog before cancel / no-show actions.
- [ ] Email notification display (toast) when session is booked or completed — backend already sends these.
- [ ] Progress indicator on the coaching request card (e.g. "2 of 3 sessions completed").
