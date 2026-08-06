# Community — Frontend Integration Guide

This guide shows how to swap the in-memory mock services for the **real backend**
that now ships in `gdec-tokens-backend`. It is the practical companion to
[`community.md`](./community.md) (the API contract) and reflects the endpoints,
shapes, and real-time events the backend **actually implements** today.

> TL;DR — the migration is localized to two service files
> (`community.service.js`, `communities.service.js`). Hooks, components and pages
> need no changes, except (1) adopting `useInfiniteQuery` for feed pagination and
> (2) handling a few new SSE event types for live updates.

---

## Table of contents

1. [Conventions & base URL](#1-conventions--base-url)
2. [Shape changes to know about](#2-shape-changes-to-know-about)
3. [`community.service.js` — rewrite](#3-communityservicejs--rewrite)
4. [`communities.service.js` — rewrite](#4-communitiesservicejs--rewrite)
5. [Feed pagination (`useInfiniteQuery`)](#5-feed-pagination-useinfinitequery)
6. [Attachments (presigned upload)](#6-attachments-presigned-upload)
7. [People-picker (mentions / praise)](#7-people-picker-mentions--praise)
8. [Real-time (SSE) live updates](#8-real-time-sse-live-updates)
9. [Enums via `/community/meta`](#9-enums-via-communitymeta)
10. [Admin: community management](#10-admin-community-management)
11. [Error handling](#11-error-handling)
12. [Endpoint quick reference](#12-endpoint-quick-reference)

---

## 1. Conventions & base URL

- **Base URL:** `VITE_API_URL` (default `http://localhost:3000/api`). All paths
  below are relative to it — `authenticatedApiClient` already prepends it.
- **Auth:** every Community endpoint requires `Authorization: Bearer <accessToken>`.
  `authenticatedApiClient` adds it automatically. A **401** triggers global logout
  (existing `AuthContext` behavior).
- **Content type:** `application/json` everywhere except the direct S3 `PUT`.
- **Timestamps:** ISO-8601 UTC strings.
- **Computed fields** (`myReaction`, `poll.myVote`, `isJoined`, `isPending`,
  `role`, `seenBy`) are derived server-side from your token — never send them.

---

## 2. Shape changes to know about

The response shapes match the mock **except** for these intentional differences:

| Area | Mock | Real backend | Action |
| --- | --- | --- | --- |
| **Feed response** | `{ posts, pinned }` | `{ posts, pinned, nextCursor }` | Adopt `useInfiniteQuery` (§5). `nextCursor` is `null` on the last page. |
| **`mentions` (create)** | array of `{ id, name }` | array of **user-id strings** | Send `mentions: ['u2', ...]`. The server hydrates names/avatars in the response. |
| **`praisedPeople` (create)** | array of `{ id, name }` | array of **user-id strings** | Send `praisedPeople: ['u1', ...]`. |
| **Post object** | — | adds `commentsCount` | Additive; safe to ignore or use for "view all N comments". |
| **Feed card comments** | all comments | latest **2** per post | The card already shows the last 2 — fetch full list via `GET /community/:id`. |
| **Presigned upload** | n/a | returns `{ uploadUrl, fileUrl, key }` | Use `fileUrl` (not `url`) as `attachments[].url` (§6). |

Everything else (`Post`, `Community`, `Comment`, `Poll`, `Member`, `JoinRequest`)
matches `community.md` §3 exactly.

---

## 3. `community.service.js` — rewrite

Each function keeps its **name, arguments and return shape**; only the body
changes from mock logic to an `authenticatedApiClient(...)` call.

```js
import { authenticatedApiClient } from '../config/api';

const qs = (params) => {
  const sp = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') sp.append(k, v);
  });
  const s = sp.toString();
  return s ? `?${s}` : '';
};

// ─── Feed & posts ──────────────────────────────────────────────────────────

// Returns { posts, pinned, nextCursor }
export const listAnnouncements = ({ type, sort, topic, scope, communityId, cursor, limit } = {}) =>
  authenticatedApiClient(
    `/community${qs({ type, sort, topic, scope, communityId, cursor, limit })}`,
  );

export const getAnnouncement = (id) => authenticatedApiClient(`/community/${id}`);

export const createAnnouncement = (payload) =>
  authenticatedApiClient('/community', {
    method: 'POST',
    body: JSON.stringify(payload), // see payload shape below
  });

// ─── Interactions (each returns the updated Post) ────────────────────────────

export const reactToPost = (postId, type) =>
  authenticatedApiClient(`/community/${postId}/react`, {
    method: 'POST',
    body: JSON.stringify({ type }),
  });

export const addComment = (postId, { text }) =>
  authenticatedApiClient(`/community/${postId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  });

export const votePoll = (postId, optionId) =>
  authenticatedApiClient(`/community/${postId}/vote`, {
    method: 'POST',
    body: JSON.stringify({ optionId }),
  });

export const togglePin = (postId) =>
  authenticatedApiClient(`/community/${postId}/pin`, { method: 'POST' });

export const markSeen = (postId) =>
  authenticatedApiClient(`/community/${postId}/seen`, { method: 'POST' });

// ─── People-picker ───────────────────────────────────────────────────────────

export const searchUsers = (q) =>
  authenticatedApiClient(`/users/search${qs({ q })}`); // → UserBrief[]
```

**`createAnnouncement` payload** (send IDs for mentions/praise):

```js
{
  type: 'praise',                 // discussion | question | praise | poll
  communityId: 'general',
  title: 'Kudos to Joanne',       // required for question/poll
  body: 'plain text fallback',
  bodyHtml: '<p>…</p>',           // sanitized server-side on write
  topics: ['Kudos'],
  mentions: ['u2'],               // user IDs
  attachments: [{ type: 'image', url: 'https://…', name: 'kudos.png' }],
  badge: 'kudos',                 // praise only
  praisedPeople: ['u1'],          // praise only, user IDs
  pollOptions: ['Option A', 'Option B'], // poll only, 2–8
}
```

The composer's client-side validation (`CreatePostModal.jsx`) already matches the
server rules (`community.md` §13); the server re-validates and returns `400` with
a `message` you can surface.

---

## 4. `communities.service.js` — rewrite

```js
import { authenticatedApiClient } from '../config/api';

export const listCommunities = ({ filter, q } = {}) =>
  authenticatedApiClient(`/communities${qs({ filter, q })}`); // → Community[]

export const getCommunity = (id) => authenticatedApiClient(`/communities/${id}`);

// Membership — each returns the updated Community
export const joinCommunity = (id) =>
  authenticatedApiClient(`/communities/${id}/join`, { method: 'POST' });

export const leaveCommunity = (id) =>
  authenticatedApiClient(`/communities/${id}/leave`, { method: 'POST' });

export const cancelRequest = (id) =>
  authenticatedApiClient(`/communities/${id}/request`, { method: 'DELETE' });

export const listMembers = (id) =>
  authenticatedApiClient(`/communities/${id}/members`); // → Member[]

// Admin
export const listRequests = (id) =>
  authenticatedApiClient(`/communities/${id}/requests`); // → JoinRequest[]

export const approveRequest = (id, userId) =>
  authenticatedApiClient(`/communities/${id}/requests/${userId}/approve`, { method: 'POST' });

export const declineRequest = (id, userId) =>
  authenticatedApiClient(`/communities/${id}/requests/${userId}/decline`, { method: 'POST' });
```

**Cross-service helpers can be dropped** — the backend handles them:

- `getJoinedCommunityIds` → gone. `scope=home` filtering is server-side.
- `getCommunityBrief` → gone. Each post embeds its `community` brief.
- `getPostableCommunities` → `listCommunities({ filter: 'joined' })`.

> Membership mutations return the updated `Community`, so invalidate **both** the
> communities cache and the feed cache on success (the join button + Home feed
> both depend on membership) — same as the mock did.

---

## 5. Feed pagination (`useInfiniteQuery`)

The only hook change. In `useCommunity.js`, swap `useQuery` → `useInfiniteQuery`:

```js
import { useInfiniteQuery } from '@tanstack/react-query';
import { listAnnouncements } from '../services/community.service';

export function useFeed({ scope = 'all', type, sort = 'recent', topic, communityId } = {}) {
  return useInfiniteQuery({
    queryKey: ['community', 'feed', { scope, type, sort, topic, communityId }],
    queryFn: ({ pageParam }) =>
      listAnnouncements({ scope, type, sort, topic, communityId, cursor: pageParam, limit: 20 }),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}
```

Then in the page/component:

```js
const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useFeed(filters);
const posts  = data?.pages.flatMap((p) => p.posts) ?? [];
const pinned = data?.pages[0]?.pinned ?? []; // pinned is identical on every page; use page 0
```

Notes:
- `pinned` is returned on every page (not paginated). Read it from the first page.
- `cursor` is opaque (base64). Never construct it client-side — just echo
  `nextCursor`.
- `sort=popular` orders by total reactions; `sort=recent` (default) by newest.

If you want to ship without infinite scroll first, just call
`listAnnouncements({...})` once and read `.posts`/`.pinned`; ignore `nextCursor`.

---

## 6. Attachments (presigned upload)

Reuse the **existing** presigned flow (the same one
`useAttachmentUpload.js` / `tokenRequests.service.js` already use). No new
endpoint.

```js
// 1) Ask the backend for a presigned PUT URL
const { uploadUrl, fileUrl } = await authenticatedApiClient(
  `/token-requests/presigned-upload${qs({ fileName: file.name, contentType: file.type })}`,
);

// 2) PUT the bytes straight to S3 (no auth header on this request)
await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });

// 3) Use the returned fileUrl when creating the post
attachments.push({ type: file.type.startsWith('image/') ? 'image' : 'file', url: fileUrl, name: file.name });
```

> ⚠️ The presigned response key is **`fileUrl`**, not `url`. Map it to
> `attachments[].url`. URLs expire for upload after 5 minutes — upload promptly.
> GIFs (Giphy URLs) are sent as `{ type: 'image', url: <giphyUrl> }` directly; no
> upload needed.

---

## 7. People-picker (mentions / praise)

`searchUsers(q)` → `GET /users/search?q=` returns up to 8
`UserBrief { id, name, avatarUrl }`. Empty `q` returns a small suggested set.

In the composer, store the **selected user IDs** and send them as
`mentions` / `praisedPeople` (string arrays). The created post's response contains
the hydrated `mentions` / `praisedPeople` objects for rendering.

---

## 8. Real-time (SSE) live updates

The backend pushes Community events over the **existing** SSE stream
(`GET /notifications/stream`, already wired in `NotificationContext`). Two
categories arrive on that stream:

**A. Persistent notifications** (bell entries) — already handled by
`NotificationContext`. Created for: **mentions**, **praise**, **replies on your
post**, and **join-request decisions** (and new join requests → community admins).
These arrive as the existing events:

```js
{ type: 'notification', notification: { title, message, metadata: { deeplink, postId, communityId }, … } }
{ type: 'init', notifications: [ … ] } // on connect
```

`metadata.deeplink` is the path the CTA should navigate to (e.g.
`/community/<postId>` or `/communities/<communityId>`).

**B. Ephemeral live-feed events** (no bell entry) — for in-place UI updates.
Add a branch to your SSE `onmessage` handler to invalidate React Query caches:

```js
const data = JSON.parse(event.data);

switch (data.type) {
  case 'community.post.created':
    queryClient.invalidateQueries({ queryKey: ['community', 'feed'] });
    break;
  case 'community.comment.added':
  case 'community.reaction.changed':
    queryClient.invalidateQueries({ queryKey: ['community', 'feed'] });
    if (data.postId) queryClient.invalidateQueries({ queryKey: ['community', 'post', data.postId] });
    break;
  // existing cases: 'notification', 'init' …
}
```

Event payloads:

| `type` | Fields | Recipients |
| --- | --- | --- |
| `community.post.created` | `postId`, `communityId` | members of the community (except author) |
| `community.comment.added` | `postId`, `communityId` | community members (except commenter) |
| `community.reaction.changed` | `postId`, `communityId` | community members (except actor) |

Real-time is **optional** — without the handler the app still works; users just
need to refetch to see others' activity.

---

## 9. Enums via `/community/meta`

Stop hard-coding enums; fetch them once and cache:

```js
export const getCommunityMeta = () => authenticatedApiClient('/community/meta');
// → { postTypes, reactions, badges, resourceTypes }
```

Values match `community.md` §4. Safe to keep client-side constants as a fallback.

---

## 10. Admin: community management

These power an admin UI (no mock equivalent — build as needed).

```js
// Create a community — PLATFORM ADMIN only (403 otherwise)
export const createCommunity = (payload) =>
  authenticatedApiClient('/communities', { method: 'POST', body: JSON.stringify(payload) });
// payload: { id?, name, slug?, description?, about?, avatarUrl?, coverUrl?, privacy?, topics?, resources? }
// `id` optional human slug (lowercase/numbers/hyphens); a UUID is generated if omitted.

// Edit metadata — community admin OR platform admin
export const updateCommunity = (id, patch) =>
  authenticatedApiClient(`/communities/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
// patch: any of { name, description, about, avatarUrl, coverUrl, privacy, topics }

// Replace the About-tab resource list — admin
export const setCommunityResources = (id, resources) =>
  authenticatedApiClient(`/communities/${id}/resources`, {
    method: 'PUT',
    body: JSON.stringify({ resources }), // [{ type, label, url }]
  });

// Promote / demote a member — admin → returns updated Member[]
export const setMemberRole = (id, userId, role) =>
  authenticatedApiClient(`/communities/${id}/members/${userId}/role`, {
    method: 'POST',
    body: JSON.stringify({ role }), // 'admin' | 'member'
  });
```

The default **`1GDEC`** community (id `general`, public) is seeded with every
active employee auto-joined, so the Home feed works on day one.

---

## 11. Error handling

The client treats any non-2xx as an error and reads `message`
(matches `config/api.js`). Notable statuses:

| Status | When | UI |
| --- | --- | --- |
| `400` | validation (missing title, bad poll, etc.) | show `message` in the composer |
| `401` | auth failure | global logout (existing) |
| `403` | private community you're not in; posting where you're not a member; non-admin hitting an admin route | "You don't have access" |
| `404` | post/community not found **or** not visible to you (private) | not-found state |
| `409` | creating a community whose id already exists | "That id is taken" |

---

## 12. Endpoint quick reference

| Service fn | Method & path |
| --- | --- |
| `listAnnouncements` | `GET /community?scope&communityId&type&sort&topic&cursor&limit` |
| `getAnnouncement` | `GET /community/:id` |
| `createAnnouncement` | `POST /community` |
| `reactToPost` | `POST /community/:id/react` |
| `addComment` | `POST /community/:id/comments` |
| `votePoll` | `POST /community/:id/vote` |
| `togglePin` | `POST /community/:id/pin` *(admin)* |
| `markSeen` | `POST /community/:id/seen` |
| `searchUsers` | `GET /users/search?q=` |
| (meta) | `GET /community/meta` |
| `listCommunities` | `GET /communities?filter&q` |
| `getCommunity` | `GET /communities/:id` |
| `joinCommunity` | `POST /communities/:id/join` |
| `leaveCommunity` | `POST /communities/:id/leave` |
| `cancelRequest` | `DELETE /communities/:id/request` |
| `listMembers` | `GET /communities/:id/members` |
| `listRequests` | `GET /communities/:id/requests` *(admin)* |
| `approveRequest` | `POST /communities/:id/requests/:userId/approve` *(admin)* |
| `declineRequest` | `POST /communities/:id/requests/:userId/decline` *(admin)* |
| `createCommunity` | `POST /communities` *(platform admin)* |
| `updateCommunity` | `PATCH /communities/:id` *(admin)* |
| `setCommunityResources` | `PUT /communities/:id/resources` *(admin)* |
| `setMemberRole` | `POST /communities/:id/members/:userId/role` *(admin)* |
| (attachments) | `GET /token-requests/presigned-upload?fileName&contentType` |
| (real-time) | `GET /notifications/stream` (SSE, already wired) |

---

_Backend reference: `src/communities/` (spaces + membership + admin) and
`src/community/` (feed + posts + interactions). Keep this guide in sync when those
change._
