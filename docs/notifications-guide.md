# 🔔 Frontend Implementation Guide: In-App Notifications (SSE)

## 📋 Project Brief

Implement a **real-time in-app notification system** for the GDEC Tokens frontend using **Server-Sent Events (SSE)**. Each user has a persistent connection to the backend that receives push notifications instantly — no polling required.

Notifications are triggered automatically by the backend at every key point in the token request approval workflow.

---

## 🎯 API Endpoints

**Base URL:** `https://tokens-staging.greatdealscorp.com/api`

| Method   | Endpoint                      | Purpose                                         | Auth Required |
| -------- | ----------------------------- | ----------------------------------------------- | ------------- |
| `GET`    | `/notifications/stream`       | Open SSE connection — receives real-time events | Yes           |
| `GET`    | `/notifications`              | Fetch last 50 notifications (newest first)      | Yes           |
| `GET`    | `/notifications/unread-count` | Badge count for the bell icon                   | Yes           |
| `PATCH`  | `/notifications/:id/read`     | Mark a single notification as read              | Yes           |
| `PATCH`  | `/notifications/read-all`     | Mark all notifications as read                  | Yes           |
| `DELETE` | `/notifications/:id`          | Dismiss (permanently delete) a notification     | Yes           |

---

## 📝 Important Notes

- **All endpoints require a valid JWT** in the `Authorization: Bearer <token>` header — including the SSE stream.
- The SSE stream sends **existing unread notifications on connect** (`type: 'init'`), so no separate initial fetch is needed.
- **Multiple tabs are supported** — all open tabs receive the same push events simultaneously.
- Notifications are scoped to the **logged-in user** — users only receive their own notifications.
- The bell badge should use `unread-count` for the initial load, then increment/decrement based on SSE events locally to avoid extra API calls.

---

## 📐 Data Models

### `Notification` object

```typescript
interface Notification {
  id: string; // UUID
  userId: string;
  title: string; // e.g. "Request Approved"
  message: string; // e.g. "Your Learning Subsidy request has been approved."
  type: 'info' | 'success' | 'warning' | 'error';
  requestId: string | null; // UUID of the related token request (if any)
  isRead: boolean;
  createdAt: string; // ISO 8601 timestamp
}
```

### SSE Event — `type: 'init'` (sent on connect)

Fired immediately when the SSE connection is established. Contains all current unread notifications (up to 10).

```typescript
{
  type: 'init';
  notifications: Notification[];
}
```

### SSE Event — `type: 'notification'` (live push)

Fired whenever a new notification is created for the user.

```typescript
{
  type: 'notification';
  notification: Notification;
}
```

### Response — `GET /notifications`

```typescript
Notification[]  // Array, newest first, max 50
```

### Response — `GET /notifications/unread-count`

```typescript
{
  count: number;
}
```

---

## 🔔 What Triggers Notifications

| Event                               | Who receives it  | Type      | Example message                                                                                            |
| ----------------------------------- | ---------------- | --------- | ---------------------------------------------------------------------------------------------------------- |
| Employee submits a request          | Employee         | `info`    | "Your Task Offloading request has been submitted and is pending approval."                                 |
| Request assigned to manager/coach   | Manager or Coach | `info`    | "A new token request from Juan dela Cruz requires your approval."                                          |
| Manager/coach approves → goes to HR | HR               | `info`    | "A token request from Juan dela Cruz has been approved by their manager and requires your final approval." |
| HR gives final approval             | Employee         | `success` | "Your Learning Subsidy request has been approved!"                                                         |
| Request rejected (any level)        | Employee         | `error`   | "Your Coaching request has been rejected."                                                                 |

---

## 🔌 Connecting to the SSE Stream

```typescript
// Use the native EventSource API (or a wrapper like @microsoft/fetch-event-source for auth support)
// NOTE: Native EventSource does NOT support custom headers.
// Use fetch-based SSE when Authorization header is needed.

import { fetchEventSource } from '@microsoft/fetch-event-source';

const token = localStorage.getItem('accessToken');

fetchEventSource(
  'https://tokens-staging.greatdealscorp.com/api/notifications/stream',
  {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    onmessage(event) {
      const data = JSON.parse(event.data);

      if (data.type === 'init') {
        // Seed the notification list with existing unread items
        setNotifications(data.notifications);
        setBadgeCount(data.notifications.length);
      }

      if (data.type === 'notification') {
        // Prepend new notification to list
        setNotifications((prev) => [data.notification, ...prev]);
        // Increment badge
        setBadgeCount((prev) => prev + 1);
        // Optionally show a toast
        showToast(data.notification);
      }
    },
    onerror(err) {
      console.error('SSE error', err);
      // fetchEventSource auto-retries on disconnect
    },
  },
);
```

> **Package:** `npm install @microsoft/fetch-event-source`
> This is required because native `EventSource` cannot send `Authorization` headers.

---

## 🔁 Reconnection Behavior

`@microsoft/fetch-event-source` automatically reconnects on disconnect (network blip, server restart, etc.). You do not need to implement retry logic manually.

If using native `EventSource`, implement your own reconnect:

```typescript
function connect() {
  const es = new EventSource('/api/notifications/stream?token=...');
  es.onerror = () => {
    es.close();
    setTimeout(connect, 3000);
  };
}
```

---

## 🧪 curl Test Commands

### Fetch all notifications

```bash
curl https://tokens-staging.greatdealscorp.com/api/notifications \
  -H "Authorization: Bearer <token>"
```

### Get unread badge count

```bash
curl https://tokens-staging.greatdealscorp.com/api/notifications/unread-count \
  -H "Authorization: Bearer <token>"
```

### Mark one as read

```bash
curl -X PATCH https://tokens-staging.greatdealscorp.com/api/notifications/<id>/read \
  -H "Authorization: Bearer <token>"
```

### Mark all as read

```bash
curl -X PATCH https://tokens-staging.greatdealscorp.com/api/notifications/read-all \
  -H "Authorization: Bearer <token>"
```

### Dismiss a notification

```bash
curl -X DELETE https://tokens-staging.greatdealscorp.com/api/notifications/<id> \
  -H "Authorization: Bearer <token>"
```

---

## 🖥️ Frontend Requirements

### Bell Icon (all authenticated pages)

- Show **unread badge count** from `GET /notifications/unread-count` on page load
- Increment badge count when SSE `type: 'notification'` event arrives
- Reset badge to 0 when user clicks "Mark all as read"

### Notification Dropdown / Panel

- List notifications from `GET /notifications` (or from SSE `init` event)
- Unread items visually distinct (bold, dot indicator, background tint)
- Clicking a notification with a `requestId`:
  - Marks it as read via `PATCH /notifications/:id/read`
  - Navigates to the relevant request detail page
- "Mark all as read" button → calls `PATCH /notifications/read-all`
- Dismiss button (×) on each item → calls `DELETE /notifications/:id`

### Toast Notifications (optional but recommended)

- Display a brief toast in the corner when a new SSE `notification` event arrives
- Auto-dismiss after 4–5 seconds
- Color-coded by `type`: green for `success`, red for `error`, blue for `info`, yellow for `warning`

---

## 🔄 State Management Flow

```
App mount
  │
  ├── GET /notifications/unread-count → set badge
  │
  └── Open SSE /notifications/stream
        │
        ├── on 'init'  → set notification list + badge count
        │
        └── on 'notification' → prepend to list + increment badge + show toast

User opens notification panel
  └── (list already populated from SSE init — no extra fetch needed)

User clicks a notification
  └── PATCH /notifications/:id/read → mark isRead = true → update local state

User clicks "Mark all as read"
  └── PATCH /notifications/read-all → set all isRead = true → set badge = 0

User clicks dismiss (×)
  └── DELETE /notifications/:id → remove from local list
```

---

## ✅ Success Criteria

### Must Have

- [ ] SSE connection opened on login, closed on logout
- [ ] Bell icon shows live unread badge count
- [ ] New notifications appear instantly without page refresh
- [ ] Clicking a notification with `requestId` navigates to that request
- [ ] Mark as read / mark all as read works correctly
- [ ] Dismiss (delete) removes notification from list

### Should Have

- [ ] Toast popup for incoming live notifications
- [ ] Color-coded notification types (success / error / info / warning)
- [ ] Auto-reconnect if SSE connection drops

### Nice to Have

- [ ] Sound or browser push notification on new `error` or `success` type
- [ ] "Load more" if user has more than 50 notifications
- [ ] Notification panel shows relative time ("2 minutes ago")
