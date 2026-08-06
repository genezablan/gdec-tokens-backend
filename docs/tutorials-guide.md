# 🎬 Frontend Implementation Guide: Tutorials (Video Guide)

## 📋 Project Brief

Implement the **Video Guide** — a grid of tutorial cards (thumbnail, category label, title, and
duration) that play self-hosted videos. The list is **public**: it renders without a logged-in user.

Tutorials are managed by **admins**, who create each entry and upload its video + thumbnail
**directly to S3** using presigned PUT URLs (the files never pass through the API server). The public
read endpoints return short-lived presigned GET URLs for playback and thumbnails.

---

## 🎯 Backend API Endpoints

**Base URL:** `http://localhost:3000/api`

### Public (no auth)

| Method | Endpoint           | Purpose                                                         | Auth Required |
| ------ | ------------------ | -------------------------------------------------------------- | ------------- |
| `GET`  | `/tutorials`       | List active tutorials (those with a video), ordered for display | No            |
| `GET`  | `/tutorials/:id`   | Get a single tutorial with presigned video/thumbnail URLs       | No            |

### Admin only (`Authorization: Bearer <token>`, role `admin`)

| Method   | Endpoint                                                                          | Purpose                                               |
| -------- | --------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `POST`   | `/tutorials`                                                                      | Create a tutorial record (draft — no video yet)       |
| `PATCH`  | `/tutorials/:id`                                                                  | Update title, category, description, duration, order, isActive |
| `DELETE` | `/tutorials/:id`                                                                  | Delete a tutorial                                     |
| `GET`    | `/tutorials/:id/video/presigned-upload?fileName=intro.mp4&contentType=video/mp4`  | Get a short-lived S3 PUT URL for the **video**        |
| `PATCH`  | `/tutorials/:id/video`                                                            | Save the video S3 `key` after the browser uploaded it |
| `GET`    | `/tutorials/:id/thumbnail/presigned-upload?fileName=t.jpg&contentType=image/jpeg` | Get a short-lived S3 PUT URL for the **thumbnail**     |
| `PATCH`  | `/tutorials/:id/thumbnail`                                                        | Save the thumbnail S3 `key` after the browser uploaded it |

---

## ⚠️ Important Notes

- **Reads are public** — `GET /tutorials` and `GET /tutorials/:id` work with no `Authorization`
  header. All mutating endpoints require an **admin** JWT.
- `videoUrl` and `thumbnailUrl` are **presigned GET URLs valid for 2 hours**. Do not cache them
  beyond that window — re-fetch the list/detail to get fresh URLs when they expire.
- `thumbnailUrl` can be `null` (no thumbnail uploaded). `videoUrl` is `null` only for drafts; the
  public list **never** returns drafts (see next point), so on `GET /tutorials` you can treat
  `videoUrl` as always present.
- The **public list only includes tutorials that are `isActive` AND have a video**. A freshly
  created tutorial (no video, or `isActive: false`) is hidden until both are satisfied.
- `displayOrder` controls card order — the list is sorted **ascending** by it.
- `durationSeconds` is the total length in seconds (e.g. `572`). Format it client-side to `"9:32"`.
- Video upload uses a **3-step flow** (presigned URL → S3 PUT → save key). Same for thumbnails.
- Accepted video types: `video/mp4`, `video/webm`, `video/quicktime`.
  Accepted thumbnail types: `image/jpeg`, `image/png`, `image/webp`. Validate client-side before
  requesting the upload URL — the API rejects others with `400`.
- The S3 PUT request must **not** include the `Authorization` header — the presigned URL is
  self-signed. Its `Content-Type` must match the `contentType` you requested.

---

## 🔄 Admin Upload Flow (video or thumbnail)

```
┌──────────┐         ┌──────────────┐           ┌─────────┐
│  Admin   │         │  NestJS API  │           │  S3     │
│ Frontend │         │              │           │         │
└────┬─────┘         └──────┬───────┘           └────┬────┘
     │                      │                        │
     │ POST /tutorials      │                        │
     │ { title, category…}  │                        │
     │─────────────────────►│  Create draft record   │
     │   { id, … }          │                        │
     │◄─────────────────────│                        │
     │                      │                        │
     │ GET /tutorials/:id/  │                        │
     │ video/presigned-     │                        │
     │ upload?fileName=&     │                        │
     │ contentType=         │                        │
     │─────────────────────►│  Presigned PUT (5 min) │
     │ { uploadUrl, key }   │                        │
     │◄─────────────────────│                        │
     │                      │                        │
     │ PUT <uploadUrl>      │                        │
     │ (file bytes, no JWT) │                        │
     │─────────────────────────────────────────────►│
     │                      │              200 OK    │
     │◄─────────────────────────────────────────────│
     │                      │                        │
     │ PATCH /tutorials/:id/video                    │
     │ { key }              │                        │
     │─────────────────────►│  Save key to DB        │
     │ Updated Tutorial     │                        │
     │◄─────────────────────│                        │
```

**Step 0** — `POST /tutorials` with the metadata to create the record and get its `id`.
**Step 1** — `GET …/video/presigned-upload` with the file's name and MIME type.
**Step 2** — `PUT` the file directly to S3 using `uploadUrl`. No auth header — the URL is self-signed.
**Step 3** — `PATCH …/video` with the returned `key`. Repeat Steps 1–3 for the thumbnail.

> Once the video is saved and `isActive` is `true`, the tutorial appears in the public Video Guide.

---

## 📐 Data Models

### Tutorial (response from `GET /tutorials`, `GET /tutorials/:id`, and all admin writes)

```typescript
interface Tutorial {
  id: string;
  title: string;
  category: string; // small label above the title, e.g. "Quick Start Tutorials"
  description: string | null;
  durationSeconds: number | null; // total length in seconds; format client-side
  displayOrder: number; // ascending sort order in the grid
  isActive: boolean;
  videoUrl: string | null; // presigned S3 GET URL (2-hour TTL); null only for drafts
  thumbnailUrl: string | null; // presigned S3 GET URL (2-hour TTL) or null
  createdAt: string;
  updatedAt: string;
}
```

### POST /tutorials request body (`application/json`)

```typescript
interface CreateTutorialBody {
  title: string; // required
  category: string; // required
  description?: string;
  durationSeconds?: number; // >= 0
  displayOrder?: number; // >= 0, default 0
  isActive?: boolean; // default true
}
```

### PATCH /tutorials/:id request body (`application/json`)

All fields optional — send only what changed. Same shape as `CreateTutorialBody`.

### Presigned-upload response (`GET …/video|thumbnail/presigned-upload`)

```typescript
interface PresignedUploadResponse {
  uploadUrl: string; // presigned S3 PUT URL — expires in 5 minutes
  fileUrl: string; // permanent S3 object URL (informational; not used for playback)
  key: string; // S3 key to pass back in PATCH …/video|thumbnail
}
```

### PATCH /tutorials/:id/video and /thumbnail request body (`application/json`)

```typescript
interface SaveAssetBody {
  key: string; // the `key` returned by the presigned-upload endpoint
}
```

### DELETE /tutorials/:id response

```typescript
{ "deleted": true }
```

---

## 🧪 Curl Test Commands

### Public — list tutorials (no auth)

```bash
curl http://localhost:3000/api/tutorials
```

### Public — single tutorial

```bash
curl http://localhost:3000/api/tutorials/<id>
```

### Admin — create a draft tutorial

```bash
curl -X POST http://localhost:3000/api/tutorials \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{
        "title": "Getting Started: Understanding Development Options",
        "category": "Quick Start Tutorials",
        "description": "A short intro.",
        "durationSeconds": 572,
        "displayOrder": 1
      }'
```

### Admin — Step 1: get presigned URL for the video

```bash
curl -X GET "http://localhost:3000/api/tutorials/<id>/video/presigned-upload?fileName=intro.mp4&contentType=video/mp4" \
  -H "Authorization: Bearer <admin-token>"

# Response:
# {
#   "uploadUrl": "https://gdec-tokens-development.s3.ap-southeast-1.amazonaws.com/tutorials/<id>/video/...",
#   "fileUrl":   "https://gdec-tokens-development.s3.ap-southeast-1.amazonaws.com/tutorials/<id>/video/...",
#   "key":       "tutorials/<id>/video/<uuid>/intro.mp4"
# }
```

### Admin — Step 2: PUT the file directly to S3 (no JWT)

```bash
curl -X PUT "<uploadUrl from step 1>" \
  -H "Content-Type: video/mp4" \
  --data-binary @/path/to/intro.mp4
```

### Admin — Step 3: save the video key

```bash
curl -X PATCH http://localhost:3000/api/tutorials/<id>/video \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{ "key": "tutorials/<id>/video/<uuid>/intro.mp4" }'
```

### Admin — thumbnail (same 3 steps)

```bash
curl -X GET "http://localhost:3000/api/tutorials/<id>/thumbnail/presigned-upload?fileName=thumb.jpg&contentType=image/jpeg" \
  -H "Authorization: Bearer <admin-token>"

curl -X PUT "<uploadUrl>" -H "Content-Type: image/jpeg" --data-binary @/path/to/thumb.jpg

curl -X PATCH http://localhost:3000/api/tutorials/<id>/thumbnail \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{ "key": "tutorials/<id>/thumbnail/<uuid>/thumb.jpg" }'
```

### Admin — update metadata / reorder

```bash
curl -X PATCH http://localhost:3000/api/tutorials/<id> \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{ "description": "Updated copy.", "displayOrder": 2, "isActive": true }'
```

### Admin — delete

```bash
curl -X DELETE http://localhost:3000/api/tutorials/<id> \
  -H "Authorization: Bearer <admin-token>"
```

---

## 🖥️ Frontend Requirements

### Video Guide (public)

- Render a responsive grid of cards. Each card shows: `thumbnailUrl` (or a placeholder if `null`),
  the `category` label, the `title`, and the formatted `durationSeconds`.
- Cards must follow `displayOrder` (the API already returns them sorted ascending).
- Clicking a card / play button opens a player using `videoUrl` (`<video controls src={videoUrl}>`).
  Presigned URLs support range requests, so seeking/scrubbing works out of the box.
- Because `videoUrl`/`thumbnailUrl` expire after **2 hours**, re-fetch `GET /tutorials` on page load
  (and if a user lingers, on focus after a long idle) so URLs stay fresh.

### Duration formatting

```typescript
function formatDuration(totalSeconds: number | null): string {
  if (totalSeconds == null) return '';
  const m = Math.floor(totalSeconds / 60);
  const s = String(totalSeconds % 60).padStart(2, '0');
  return `${m}:${s}`;
}
```

### Admin management page (role `admin`)

- A table/list of all tutorials. Fetch with `GET /tutorials?all=true` to include drafts and inactive
  ones (the `?all=true` flag bypasses the active+has-video filter).
- **Create** opens a form (title, category, description, duration, order, active toggle) → `POST`.
- **Edit** updates metadata via `PATCH /tutorials/:id`.
- **Reorder** — let admins set `displayOrder` (drag-and-drop or a number field) and `PATCH` each
  changed row.
- **Upload video / thumbnail** — file pickers that run the 3-step flow below.
- **Delete** with a confirmation dialog → `DELETE /tutorials/:id`.

---

## 🛠️ Implementation Steps

### Phase 1 — Public Video Guide

1. On the page that shows the Video Guide, call `GET /tutorials`.
2. Render the grid (thumbnail, category, title, formatted duration), ordered as returned.
3. Wire the play button to a modal/inline `<video controls>` using `videoUrl`.
4. Refresh the list on mount so presigned URLs are fresh.

### Phase 2 — Admin Create + Upload

```typescript
async function createTutorialWithMedia(
  meta: CreateTutorialBody,
  videoFile: File,
  thumbnailFile: File | null,
) {
  // Step 0 — create the draft record
  const tutorial = await api.post('/tutorials', meta); // { id, ... }
  const id = tutorial.id;

  // Helper for the 3-step asset upload
  async function uploadAsset(kind: 'video' | 'thumbnail', file: File) {
    const { uploadUrl, key } = await api.get(
      `/tutorials/${id}/${kind}/presigned-upload` +
        `?fileName=${encodeURIComponent(file.name)}` +
        `&contentType=${encodeURIComponent(file.type)}`,
    );

    await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type }, // no Authorization header
      body: file,
    });

    return api.patch(`/tutorials/${id}/${kind}`, { key });
  }

  await uploadAsset('video', videoFile);
  if (thumbnailFile) await uploadAsset('thumbnail', thumbnailFile);

  // Optionally publish if it was created inactive
  // await api.patch(`/tutorials/${id}`, { isActive: true });

  return id;
}
```

### Phase 3 — Polish

1. Show per-file upload progress (use `XMLHttpRequest` or `fetch` with a progress stream for the
   S3 PUT) — video files can be large.
2. Validate file type and size **before** requesting the presigned URL; show inline errors.
3. After saving, refetch the admin list so the new presigned URLs and ordering are reflected.
4. Disable the Save/Publish button while any step is in flight.

---

## ✅ Success Criteria

### Must Have

- [ ] Public Video Guide renders cards from `GET /tutorials`, ordered by `displayOrder`.
- [ ] Clicking a card plays the video via the presigned `videoUrl` (seeking works).
- [ ] Admin can create a tutorial and upload a video via the 3-step flow end to end.
- [ ] Admin can edit metadata, reorder, toggle active, and delete.
- [ ] Drafts / inactive tutorials never appear in the public list.

### Should Have

- [ ] Thumbnail upload (optional per tutorial; placeholder shown when `null`).
- [ ] Client-side validation of video/thumbnail MIME type and size.
- [ ] Upload progress indicator for the S3 PUT.
- [ ] List refreshed on mount so presigned URLs stay valid.

### Nice to Have

- [ ] Drag-and-drop reordering that batch-PATCHes changed `displayOrder` values.
- [ ] Auto-detect `durationSeconds` from the selected video file (via a hidden `<video>` element)
      and prefill the field.
```
