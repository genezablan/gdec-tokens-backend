# Community & Communities — Backend API Specification

This document specifies the REST API the backend must implement to make the
**Community** feature dynamic. Today the frontend runs entirely on in-memory mock
services; this spec is the contract for replacing them with a real backend.

The mock services are the **source of truth for shapes** — every response below
matches what the UI already consumes. Implement these endpoints and the frontend
swap is a near mechanical change (see [§11 Frontend migration](#11-frontend-migration)).

**Relevant frontend files**

| Concern                                 | File                                                                        |
| --------------------------------------- | --------------------------------------------------------------------------- |
| Feed / posts service (mock)             | `src/services/community.service.js`                                         |
| Communities / membership service (mock) | `src/services/communities.service.js`                                       |
| React Query hooks                       | `src/hooks/useCommunity.js`, `src/hooks/useCommunities.js`                  |
| API client + auth                       | `src/config/api.js`                                                         |
| Attachment upload pattern               | `src/hooks/useAttachmentUpload.js`, `src/services/tokenRequests.service.js` |

---

## Table of contents

1. [Conventions](#1-conventions)
2. [Auth, RBAC & visibility](#2-auth-rbac--visibility)
3. [Data models](#3-data-models)
4. [Enums](#4-enums)
5. [Feed & post endpoints](#5-feed--post-endpoints)
6. [Reactions, comments, polls, pin, seen](#6-reactions-comments-polls-pin-seen)
7. [Community (spaces) endpoints](#7-community-spaces-endpoints)
8. [Membership endpoints](#8-membership-endpoints)
9. [Supporting endpoints (users, uploads)](#9-supporting-endpoints)
10. [Pagination & real-time](#10-pagination--real-time)
11. [Frontend migration](#11-frontend-migration)
12. [Suggested database schema](#12-suggested-database-schema)
13. [Validation rules](#13-validation-rules)
14. [Open questions](#14-open-questions)

---

## 1. Conventions

- **Base URL:** `VITE_API_URL` (default `http://localhost:3000/api`). All paths below are relative to it.
- **Auth:** `Authorization: Bearer <accessToken>` on every endpoint (the token from `localStorage`, sent by `authenticatedApiClient`). All Community endpoints are authenticated.
- **Content type:** `application/json` for requests and responses (except the direct S3 `PUT`).
- **Timestamps:** ISO‑8601 UTC strings (e.g. `2026-06-16T09:30:00.000Z`).
- **IDs:** opaque strings (UUID recommended). Community IDs may be human slugs (`general`, `cnb-team`) or UUIDs — the frontend treats them as opaque.
- **Error shape** (must match `src/config/api.js`):

```json
{
  "status": 404,
  "message": "Post not found",
  "error": "NotFound",
  "statusCode": 404
}
```

The client treats any non‑2xx as an error and reads `message`. A **401** anywhere triggers global logout (handled by `AuthContext`), so return 401 only for genuine auth failures.

- **Per-user computed fields:** `myReaction`, `poll.myVote`, `isJoined`, `isPending`, `role`, `seenByMe` are **derived from the caller's identity** server-side. Never trust the client for these.
- **Author identity:** on create/comment, the author is the **authenticated user** — ignore any client-sent author and derive from the token.

---

## 2. Auth, RBAC & visibility

Roles in the platform: `admin`, `approver`, `coach`, `hr_approver`, `employee` (a user may hold several). Community membership adds a **per-community role**: `admin` | `member` | `null`.

**Visibility rules**

| Community privacy | Non-member can see                                                                  | Member can see    |
| ----------------- | ----------------------------------------------------------------------------------- | ----------------- |
| `public`          | metadata, members, **feed**                                                         | everything + post |
| `private`         | metadata only (name, description, memberCount, cover) — **NOT the feed or members** | everything + post |

- Posting into a community requires membership (`isJoined = true`).
- `GET /communities/:id/requests` and the approve/decline endpoints require **community `role = admin`** (or platform `admin`). Return **403** otherwise.
- A private community's feed (`GET /community?communityId=…`) must return **403** for non-members. The UI already gates this, but the server must enforce it.
- The **Home feed** (`scope=home`) returns only posts from communities the caller has joined.

---

## 3. Data models

### 3.1 UserBrief

Used for authors, mentions, praised people, members.

```json
{ "id": "u1", "name": "Joanne Araojo", "avatarUrl": "https://…/avatar.png" }
```

`avatarUrl` may be `null` (frontend renders initials).

### 3.2 Attachment

```json
{
  "id": "att-1",
  "type": "image",
  "url": "https://cdn/…/file.png",
  "name": "kudos.png"
}
```

`type`: `image` | `file`. (GIFs are stored as `image`.)

### 3.3 Comment

```json
{
  "id": "c1",
  "author": { "name": "Jane Smith", "avatarUrl": null },
  "createdAt": "2026-06-16T09:30:00.000Z",
  "text": "Congrats! 🙌"
}
```

### 3.4 Poll

```json
{
  "options": [
    { "id": "o1", "label": "Extra learning day", "votes": 12 },
    { "id": "o2", "label": "Wellness stipend", "votes": 9 }
  ],
  "myVote": "o1"
}
```

`myVote`: the option id the caller voted for, or `null`.

### 3.5 Post

The canonical object returned by every post endpoint.

```json
{
  "id": "p_123",
  "type": "praise",
  "communityId": "general",
  "community": {
    "id": "general",
    "name": "1GDEC",
    "avatarUrl": null,
    "privacy": "public"
  },
  "author": { "name": "Hazel Anne Santos", "avatarUrl": null },
  "createdAt": "2026-06-16T09:20:00.000Z",
  "title": "Kudos to Joanne Araojo",
  "body": "Plain-text fallback for previews & search",
  "bodyHtml": "<p>Kudos to our CNB Team! 👏</p>",
  "mentions": [{ "id": "u2", "name": "Sean Nicholas Corpuz" }],
  "topics": ["Kudos", "BIR2316"],
  "attachments": [
    { "id": "a1", "type": "image", "url": "https://…", "name": "kudos.png" }
  ],
  "badge": "kudos",
  "praisedPeople": [{ "id": "u1", "name": "Joanne Araojo", "avatarUrl": null }],
  "poll": null,
  "seenBy": 144,
  "reactionCounts": { "celebrate": 6, "heart": 3, "like": 2 },
  "myReaction": null,
  "pinned": true,
  "comments": [
    /* Comment[] — see §10 for truncation */
  ]
}
```

Field notes:

- `community` is a denormalized brief of `communityId` (saves a round-trip; UI renders the source chip from it).
- `bodyHtml` is **sanitized rich HTML**; `body` is the plain-text fallback. The frontend re-sanitizes on render (`src/utils/sanitize.js`) but the server **must sanitize on write** too (never trust client HTML). Allowed tags: `p br strong b em i u s ul ol li a code pre blockquote span`; allowed attrs: `href target rel class`.
- `badge` + `praisedPeople` are present **only** when `type = praise`.
- `poll` is present **only** when `type = poll` (else `null`/absent).
- `reactionCounts` omits zero-count keys.

### 3.6 Community

```json
{
  "id": "cnb-team",
  "name": "CNB Team",
  "slug": "cnb-team",
  "description": "Compensation & Benefits team — filings, deadlines and wins.",
  "about": "Longer description shown on the About tab.",
  "avatarUrl": null,
  "coverUrl": "https://…/cover.jpg",
  "privacy": "public",
  "memberCount": 18,
  "isJoined": true,
  "isPending": false,
  "role": "member",
  "topics": ["BIR2316", "Payroll"],
  "resources": [
    {
      "id": "r1",
      "type": "onenote",
      "label": "CNB Playbook",
      "url": "https://…"
    }
  ],
  "pinnedPostIds": ["p_123"],
  "createdAt": "2025-11-01T00:00:00.000Z"
}
```

`isJoined` / `isPending` / `role` are caller-relative.

### 3.7 Member & JoinRequest

```json
// Member
{ "id": "u1", "name": "Joanne Araojo", "avatarUrl": null, "role": "member" }

// JoinRequest
{ "id": "u8", "name": "Mark Scott", "avatarUrl": null, "requestedAt": "2026-06-15T00:00:00.000Z" }
```

---

## 4. Enums

These are currently defined client-side; the backend should own canonical lists and ideally expose them (e.g. `GET /community/meta`) so both stay in sync. Until then, match exactly:

| Set                   | Values                                                                         |
| --------------------- | ------------------------------------------------------------------------------ |
| **Post type**         | `discussion`, `question`, `praise`, `poll`                                     |
| **Reaction**          | `like`, `heart`, `celebrate`, `laugh`, `insightful`                            |
| **Praise badge**      | `kudos`, `thank-you`, `great-work`, `team-player`, `above-beyond`, `innovator` |
| **Resource type**     | `sharepoint`, `onenote`, `planner`, `link`                                     |
| **Community privacy** | `public`, `private`                                                            |
| **Community role**    | `admin`, `member`, `null`                                                      |

---

## 5. Feed & post endpoints

### `GET /community`

The feed. Replaces `listAnnouncements(...)`.

**Query params**

| Param         | Type                  | Default  | Notes                                                    |
| ------------- | --------------------- | -------- | -------------------------------------------------------- |
| `scope`       | `all` \| `home`       | `all`    | `home` = only communities the caller joined              |
| `communityId` | string                | —        | restrict to one community (its page). Overrides `scope`. |
| `type`        | post type \| `all`    | `all`    | filter by post type                                      |
| `sort`        | `recent` \| `popular` | `recent` | `popular` = by total reactions                           |
| `topic`       | string                | —        | posts tagged with this topic (case-insensitive)          |
| `cursor`      | string                | —        | pagination cursor (see §10)                              |
| `limit`       | int                   | `20`     | page size                                                |

**Response** `200`

```json
{
  "posts": [
    /* Post[] */
  ],
  "pinned": [
    /* Post[] — pinned posts in scope (no pagination) */
  ],
  "nextCursor": "eyJpZCI6…" // null when no more pages
}
```

> The current mock returns `{ posts, pinned }` with no cursor. Adding `nextCursor` is the one shape change recommended for scale; it's optional for a first cut (see §10).

- For `communityId` of a **private** community where caller isn't a member → **403**.
- `pinned` should reflect the same scope (global pinned for Home; community's pinned for a community page).

### `GET /community/:id`

A single post with **all** comments. Replaces `getAnnouncement`.

**Response** `200` → `Post` (with full `comments`). `404` if not found / not visible to caller.

### `POST /community`

Create a post. Replaces `createAnnouncement`.

**Request body**

```json
{
  "type": "praise",
  "communityId": "general",
  "title": "Kudos to Joanne Araojo",
  "body": "plain text fallback",
  "bodyHtml": "<p>…</p>",
  "topics": ["Kudos"],
  "mentions": ["u2"],
  "attachments": [{ "type": "image", "url": "https://…", "name": "kudos.png" }],
  "badge": "kudos",
  "praisedPeople": ["u1"],
  "pollOptions": ["Option A", "Option B"]
}
```

Notes:

- **`author` is derived from the token** — do not accept it from the client.
- `mentions` / `praisedPeople`: send **user IDs**; the server hydrates names/avatars in the response. (The mock sends `{id,name}` objects; accepting IDs is cleaner — the frontend can be adjusted to send IDs.)
- `attachments[].url` come from the presigned-upload flow (§9.2).
- Type-conditional requirements — see [§13 Validation](#13-validation-rules).
- Caller must be a member of `communityId` → else **403**.

**Response** `201` → the created `Post`.

---

## 6. Reactions, comments, polls, pin, seen

All return the **updated `Post`** so the client can refresh in place (matches current hooks, which invalidate the cache on success).

### `POST /community/:id/react`

Set / switch / clear the caller's reaction (one reaction per user per post — toggling the same type clears it).

```json
// request
{ "type": "celebrate" }
```

**Response** `200` → `Post` (updated `reactionCounts` + `myReaction`).

### `POST /community/:id/comments`

```json
// request
{ "text": "Congrats! 🙌" }
```

**Response** `201` → `Post` (with the new comment appended). Author from token.

> If comments grow large, prefer returning the created `Comment` + paginating via `GET /community/:id/comments?cursor=`. See §10.

### `POST /community/:id/vote`

Vote / switch / un-vote a poll option (single choice).

```json
// request
{ "optionId": "o1" }
```

**Response** `200` → `Post` (updated `poll.options[].votes` + `poll.myVote`). `404` if the post has no poll.

### `POST /community/:id/pin`

Toggle pinned state. **Requires** community `admin` (or platform `admin`) — the mock currently allows anyone; the real API should gate it.
**Response** `200` → `Post`.

### `POST /community/:id/seen`

Record that the caller viewed the post; increments `seenBy` **once per user** (idempotent per user).
**Response** `200` → `Post` (or `204` — the client doesn't depend on the body here).

---

## 7. Community (spaces) endpoints

### `GET /communities`

Directory. Replaces `listCommunities`.

**Query params**

| Param             | Type                            | Default | Notes                              |
| ----------------- | ------------------------------- | ------- | ---------------------------------- |
| `filter`          | `all` \| `joined` \| `discover` | `all`   | `discover` = not joined            |
| `q`               | string                          | —       | search name / description / topics |
| `cursor`, `limit` |                                 |         | pagination (optional for v1)       |

**Response** `200` → `Community[]` (sorted by `memberCount` desc in the mock; backend may choose relevance). Private communities still appear in `discover`/`all` with metadata only.

### `GET /communities/:id`

Replaces `getCommunity`. **Response** `200` → `Community`. `404` if not found.

---

## 8. Membership endpoints

All membership mutations return the updated `Community` (so the join button + Home feed refresh). The frontend invalidates both the communities cache and the feed cache on success.

### `POST /communities/:id/join`

- **public** → caller becomes a `member` immediately (`isJoined=true`, `memberCount++`).
- **private** → creates a **join request** (`isPending=true`); membership unchanged until an admin approves.

**Response** `200` → `Community`.

### `POST /communities/:id/leave`

Remove the caller's membership (`isJoined=false`, `role=null`, `memberCount--`). Also clears any pending request.
**Response** `200` → `Community`.

### `DELETE /communities/:id/request`

Cancel the caller's pending join request (`isPending=false`).
**Response** `200` → `Community`.

### `GET /communities/:id/members`

Replaces `listMembers`. **Response** `200` → `Member[]`. For private communities, non-members get **403**.

### `GET /communities/:id/requests` _(admin)_

Pending join requests. **Response** `200` → `JoinRequest[]`. **403** if caller isn't a community admin.

### `POST /communities/:id/requests/:userId/approve` _(admin)_

Approve a pending request → user becomes a `member`, request removed, `memberCount++`.
**Response** `200`:

```json
{
  "members": [
    /* Member[] */
  ],
  "requests": [
    /* JoinRequest[] */
  ]
}
```

### `POST /communities/:id/requests/:userId/decline` _(admin)_

Remove the request without adding the member.
**Response** `200` → `{ "requests": [ /* JoinRequest[] */ ] }`.

---

## 9. Supporting endpoints

### 9.1 `GET /users/search?q=`

Powers the composer's people-picker (`@mentions`, praise). Replaces the mock `searchUsers`.

**Response** `200` → `UserBrief[]` (cap ~8). Empty `q` may return a small recent/suggested set. Should search the user directory the caller is allowed to see.

### 9.2 Attachment upload (presigned S3 — existing pattern)

Reuse the platform's existing flow (see `src/services/tokenRequests.service.js` / `useAttachmentUpload.js`):

1. `GET /presigned-upload?fileName=<name>&contentType=<mime>` → `{ uploadUrl, url, key, fileName }`
2. Client `PUT`s the file bytes directly to `uploadUrl` (S3).
3. Client sends the returned `url` in `attachments[].url` when creating the post.

No new endpoint needed if `/presigned-upload` already exists. Enforce content-type/size limits server-side (images for inline media; the request-form flow caps at 5 MB).

### 9.3 _(optional)_ `GET /community/meta`

Expose the enums in §4 (post types, reactions, badges, resource types, trending topics) so the frontend can stop hard-coding them.

---

## 10. Pagination & real-time

**Why it matters for "dynamic":** the mock loads the entire feed and all comments at once. That's fine for a demo, not for production.

- **Feed pagination:** cursor-based recommended (`cursor` + `nextCursor`, `limit`). Cursor encodes the sort key (createdAt+id for `recent`; reactionTotal+id for `popular`). The frontend would move from `useQuery` to `useInfiniteQuery` (small change in `useCommunity.js`).
- **Comment pagination:** for `GET /community/:id`, return the **latest N** comments + a `commentsCount`; load older via `GET /community/:id/comments?cursor=`. The feed card only shows the last 2 comments, so the list endpoint can return few by default.
- **Real-time (optional, phase 2):** the platform already runs an SSE stream (`/notifications/stream`, see `NotificationContext`). Emit events for new posts in joined communities, new comments/reactions on visible posts, mentions, and join-request decisions so the UI can live-update / notify. Mentions and replies **should** also create entries in the existing notifications system.

A first production cut can ship **without** real-time and **with** simple pagination; both are isolated additions.

---

## 11. Frontend migration

Swapping mock → real is localized to two service files. Each exported function keeps its **name, arguments, and return shape**; only the body changes from in-memory logic to an `authenticatedApiClient(...)` call. The hooks, components, and pages need **no changes** (except adopting `useInfiniteQuery` if/when feed pagination lands).

**`src/services/community.service.js`**

| Function                                                 | Becomes                        |
| -------------------------------------------------------- | ------------------------------ |
| `listAnnouncements({type,sort,topic,scope,communityId})` | `GET /community?…`             |
| `getAnnouncement(id)`                                    | `GET /community/:id`           |
| `createAnnouncement({…})`                                | `POST /community`              |
| `reactToPost(id,type)`                                   | `POST /community/:id/react`    |
| `addComment(id,{text})`                                  | `POST /community/:id/comments` |
| `votePoll(id,optionId)`                                  | `POST /community/:id/vote`     |
| `togglePin(id)`                                          | `POST /community/:id/pin`      |
| `markSeen(id)`                                           | `POST /community/:id/seen`     |
| `searchUsers(q)`                                         | `GET /users/search?q=`         |

**`src/services/communities.service.js`**

| Function                      | Becomes                                          |
| ----------------------------- | ------------------------------------------------ |
| `listCommunities({filter,q})` | `GET /communities?…`                             |
| `getCommunity(id)`            | `GET /communities/:id`                           |
| `joinCommunity(id)`           | `POST /communities/:id/join`                     |
| `leaveCommunity(id)`          | `POST /communities/:id/leave`                    |
| `cancelRequest(id)`           | `DELETE /communities/:id/request`                |
| `listMembers(id)`             | `GET /communities/:id/members`                   |
| `listRequests(id)`            | `GET /communities/:id/requests`                  |
| `approveRequest(id,userId)`   | `POST /communities/:id/requests/:userId/approve` |
| `declineRequest(id,userId)`   | `POST /communities/:id/requests/:userId/decline` |

The cross-service helpers `getJoinedCommunityIds` / `getCommunityBrief` / `getPostableCommunities` exist only because membership lives in the mock. With a real backend:

- `scope=home` filtering moves **server-side** (drop `getJoinedCommunityIds`).
- The post's `community` brief is populated **server-side** (drop `getCommunityBrief`).
- `getPostableCommunities` (composer's community selector) becomes `GET /communities?filter=joined`.

**Example** (after migration):

```js
export const reactToPost = (postId, type) =>
  authenticatedApiClient(`/community/${postId}/react`, {
    method: 'POST',
    body: JSON.stringify({ type }),
  });
```

---

## 12. Suggested database schema

Illustrative (Postgres-ish); adapt to your stack.

```
communities (
  id            text primary key,        -- slug or uuid
  name          text not null,
  slug          text unique,
  description   text,
  about         text,
  avatar_url    text,
  cover_url     text,
  privacy       text not null,           -- public | private
  created_at    timestamptz not null default now()
)

community_members (
  community_id  text references communities(id),
  user_id       text references users(id),
  role          text not null,           -- admin | member
  joined_at     timestamptz not null default now(),
  primary key (community_id, user_id)
)

community_requests (
  community_id  text references communities(id),
  user_id       text references users(id),
  requested_at  timestamptz not null default now(),
  primary key (community_id, user_id)
)

community_resources ( id, community_id, type, label, url, sort_order )
community_topics    ( community_id, topic )           -- or a topics table + join

posts (
  id            uuid primary key,
  community_id  text references communities(id),
  author_id     text references users(id),
  type          text not null,           -- discussion|question|praise|poll
  title         text,
  body          text,                    -- plain-text fallback
  body_html     text,                    -- sanitized
  badge         text,                    -- praise only
  pinned        boolean not null default false,
  created_at    timestamptz not null default now()
)

post_topics       ( post_id, topic )
post_mentions     ( post_id, user_id )
post_praised      ( post_id, user_id )   -- praise recipients
post_attachments  ( id, post_id, type, url, name, sort_order )

poll_options      ( id, post_id, label, sort_order )
poll_votes        ( post_id, option_id, user_id, primary key (post_id, user_id) )  -- single vote/user

comments          ( id, post_id, author_id, text, created_at )
reactions         ( post_id, user_id, type, primary key (post_id, user_id) )       -- one/user
post_views        ( post_id, user_id, primary key (post_id, user_id) )             -- powers seenBy
```

Derived/computed in queries:

- `seenBy` = `count(post_views)`; `seenByMe` = exists for caller.
- `reactionCounts` = group-by on `reactions`; `myReaction` = caller's row.
- `poll.options[].votes` = count on `poll_votes`; `myVote` = caller's vote.
- `memberCount` = count on `community_members`; `isJoined`/`role`/`isPending` from membership/requests for the caller.

---

## 13. Validation rules

Mirror the composer's client-side rules (`src/components/CreatePostModal.jsx`) so the UI and API agree:

| Type         | Required                                             |
| ------------ | ---------------------------------------------------- |
| `discussion` | non-empty `bodyHtml`/`body`                          |
| `question`   | non-empty `title` (≤ 150 chars); `body` optional     |
| `praise`     | ≥ 1 `praisedPeople`; non-empty `body`; valid `badge` |
| `poll`       | non-empty `title`; ≥ 2 non-empty `pollOptions` (≤ 8) |

Other limits: title ≤ 200 (question ≤ 150); poll option label ≤ 80; comment text non-empty; reaction `type` ∈ enum; sanitize `bodyHtml` to the allowed tag/attr set (§3.5). Reject posting into a community the caller hasn't joined (**403**).

---

## 14. Open questions

- **Edit / delete** of posts and comments — not in the current UI; add endpoints (`PATCH`/`DELETE /community/:id`) when needed.
- **Moderation / reporting** — flagging posts/comments; ties into the existing Message Approval workflow?
- **Notifications** — confirm which events create notification entries (mentions, comments, reactions, join approvals) and whether they fan out over the existing SSE stream.
- **Community creation/management** — settled for creation: **any authenticated user** can
  `POST /communities` to create a **private** community and becomes its community admin.
  `privacy: public` is platform-admin-only, as is claiming a human-slug `id`/`slug` (regular
  users always get a generated UUID id). The same rule guards `PATCH /communities/:id` so a
  community admin can't flip their own private space to public. Still open: who may edit
  cover/about/resources and promote admins beyond the existing community-admin check.
- **GIFs** — stored as `image` attachments today (via Giphy URLs). Decide whether to proxy/store them or keep hot-linking.
- **Enum ownership** — adopt `GET /community/meta` so badges/reactions/topics aren't duplicated client- and server-side.

---

_Generated from the mock service contracts in `src/services/community.service.js` and
`src/services/communities.service.js`. Keep this doc in sync when those shapes change._
