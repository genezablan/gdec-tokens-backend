# 👤 Frontend Implementation Guide: User Profile

## 📋 Project Brief

Allow employees to personalise their account by setting a **display nickname** and uploading a **profile picture**.
Both are optional — if unset, the frontend should fall back to the employee's full name and a default avatar.

Profile pictures are uploaded **directly to S3** using a presigned PUT URL — the file never goes through the backend server or CloudFront. This avoids CloudFront method restrictions and keeps the API fast.

---

## 🎯 Backend API Endpoints

**Base URL:** `http://localhost:3000/api`

| Method  | Endpoint                                                                   | Purpose                                                       | Auth Required |
| ------- | -------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------- |
| `GET`   | `/auth/profile`                                                            | Get current user profile (includes all fields)                | Yes           |
| `GET`   | `/auth/profile/presigned-upload?filename=photo.jpg&contentType=image/jpeg` | Get a short-lived S3 PUT URL for profile picture upload       | Yes           |
| `PATCH` | `/auth/profile`                                                            | Save nickname and/or profile picture key (`application/json`) | Yes           |

---

## ⚠️ Important Notes

- Profile picture upload uses a **3-step flow** — see Upload Flow below. The file goes directly to S3, not through the API.
- `PATCH /auth/profile` accepts **`application/json`** (not multipart).
- Both `nickname` and `profilePictureKey` are optional — send only what changed.
- To **clear** the nickname, send `"nickname": ""` — the API stores it as `null`.
- The returned `profilePicture` value is a **pre-signed GET URL valid for 15 minutes** — do not cache it beyond that window. Re-fetch `GET /auth/profile` to get a fresh URL when it expires.
- The `GET /auth/profile` response includes the `immediateSupervisor` relation; `GET /auth/me` does not.
- Accepted image types: `image/jpeg`, `image/png`, `image/webp` (validate client-side before requesting the upload URL).
- Max recommended file size: **5 MB** (enforce client-side).

---

## 🔄 Profile Picture Upload Flow

```
┌──────────┐         ┌──────────────┐           ┌─────────┐
│ Frontend │         │  NestJS API  │           │  S3     │
└────┬─────┘         └──────┬───────┘           └────┬────┘
     │                      │                        │
     │  GET /auth/profile/  │                        │
     │  presigned-upload    │                        │
     │ ?filename=photo.jpg  │                        │
     │ &contentType=image/… │                        │
     │─────────────────────►│                        │
     │                      │  Generate presigned    │
     │                      │  PUT URL (5 min TTL)   │
     │  { uploadUrl, key }  │                        │
     │◄─────────────────────│                        │
     │                      │                        │
     │  PUT <uploadUrl>     │                        │
     │  (file bytes, no JWT)│                        │
     │─────────────────────────────────────────────►│
     │                      │              200 OK    │
     │◄─────────────────────────────────────────────│
     │                      │                        │
     │  PATCH /auth/profile │                        │
     │  { profilePictureKey: key, nickname? }        │
     │─────────────────────►│                        │
     │                      │  Save key to DB        │
     │  Updated UserProfile │                        │
     │◄─────────────────────│                        │
```

**Step 1** — Call `GET /auth/profile/presigned-upload` with the file's name and MIME type.
**Step 2** — `PUT` the file directly to S3 using `uploadUrl`. No auth header needed — the URL is self-signed.
**Step 3** — Call `PATCH /auth/profile` with the returned `key` (and optionally `nickname`).

---

## 📐 Data Models

### UserProfile (GET /auth/profile response)

```typescript
interface UserProfile {
  id: string;
  employeeId: string; // e.g. "GDC-001"
  email: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  nickname: string | null; // display name override
  profilePicture: string | null; // presigned S3 GET URL (15-min TTL) or null
  department: string;
  position: string | null;
  employeeType: 'Manager' | 'Rank and file' | 'Officer';
  employeeStatus:
    | 'Regular'
    | 'Probationary'
    | 'Resigned'
    | 'AWOL'
    | 'Terminated';
  roles: ('employee' | 'coach' | 'approver' | 'admin')[];
  immediateSupervisor: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  } | null;
  isPasswordChanged: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
```

### GET /auth/profile/presigned-upload response

```typescript
interface PresignedUploadResponse {
  uploadUrl: string; // presigned S3 PUT URL — expires in 5 minutes
  key: string; // S3 key to pass back in PATCH /auth/profile
}
```

### PATCH /auth/profile request body (`application/json`)

```typescript
interface UpdateProfileBody {
  nickname?: string; // max 50 chars; empty string clears it
  profilePictureKey?: string; // the `key` returned by the presigned-upload endpoint
}
```

---

## 🧪 Curl Test Commands

### Get current profile

```bash
curl -X GET http://localhost:3000/api/auth/profile \
  -H "Authorization: Bearer <token>"
```

### Step 1 — Get presigned upload URL

```bash
curl -X GET "http://localhost:3000/api/auth/profile/presigned-upload?filename=photo.jpg&contentType=image/jpeg" \
  -H "Authorization: Bearer <token>"

# Response:
# {
#   "uploadUrl": "https://gdec-tokens.s3.ap-southeast-1.amazonaws.com/profile-pictures/...",
#   "key": "profile-pictures/<userId>/<userId>-<ts>.jpg"
# }
```

### Step 2 — PUT file directly to S3 (no JWT)

```bash
curl -X PUT "<uploadUrl from step 1>" \
  -H "Content-Type: image/jpeg" \
  --data-binary @/path/to/photo.jpg
```

### Step 3 — Save key to profile

```bash
curl -X PATCH http://localhost:3000/api/auth/profile \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{ "profilePictureKey": "profile-pictures/<userId>/..." }'
```

### Update nickname only (no picture)

```bash
curl -X PATCH http://localhost:3000/api/auth/profile \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{ "nickname": "Mo" }'
```

### Update nickname and picture together (Step 3 combined)

```bash
curl -X PATCH http://localhost:3000/api/auth/profile \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{ "nickname": "Mo", "profilePictureKey": "profile-pictures/<userId>/..." }'
```

### Clear nickname

```bash
curl -X PATCH http://localhost:3000/api/auth/profile \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{ "nickname": "" }'
```

---

## 🖥️ Frontend Requirements

### Profile Page / Settings Page

- Display the current profile picture (or a default avatar if `profilePicture` is `null`).
- Display the current nickname in an editable input (placeholder: `"Add a nickname…"` if `null`).
- **Avatar upload button** — clicking opens the system file picker (`accept="image/*"`).
  - Show a local preview (`URL.createObjectURL`) immediately after file selection.
  - Do **not** upload yet — wait until the user clicks Save.
- **Nickname input** — plain text, max 50 characters.
- A single **Save Changes** button triggers the full flow.
- Show a loading state on the save button while in-flight.
- On success: show a success toast and update the avatar and nickname everywhere (navbar, sidebar, etc.).
- On error: show an inline error message.

### Navbar / Header Avatar

- Show `profilePicture` URL if set, else show initials avatar (first + last initial).
- Because the URL is a presigned URL with a 15-min TTL, re-fetch `GET /auth/profile` on page load (or after login) to ensure the URL is fresh.

### Display Name Logic

```typescript
function getDisplayName(user: UserProfile): string {
  return user.nickname?.trim() || `${user.firstName} ${user.lastName}`;
}
```

Use this throughout the app wherever the employee's name is shown.

---

## 🛠️ Implementation Steps

### Phase 1 — Fetch and Display

1. After login, call `GET /auth/profile` and store the result in global state (Pinia / Zustand / Context).
2. Render `profilePicture` as the navbar avatar (`<img src={profilePicture}>`). Fall back to initials if `null`.
3. Use `getDisplayName()` everywhere a name is rendered.

### Phase 2 — Profile Edit Form

1. Create a **Profile Settings** page or modal.
2. Pre-fill nickname input with `user.nickname ?? ''`.
3. Show current picture with an overlay upload button.
4. On file select: show local preview via `URL.createObjectURL(file)` — do not upload yet.
5. On **Save Changes**:

```typescript
async function saveProfile(nickname: string, file: File | null) {
  let profilePictureKey: string | undefined;

  if (file) {
    // Step 1 — get presigned URL
    const { uploadUrl, key } = await api.get(
      `/auth/profile/presigned-upload?filename=${encodeURIComponent(file.name)}&contentType=${encodeURIComponent(file.type)}`,
    );

    // Step 2 — PUT directly to S3 (no Authorization header)
    await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    });

    profilePictureKey = key;
  }

  // Step 3 — save to profile
  const updated = await api.patch('/auth/profile', {
    nickname: nickname || undefined,
    profilePictureKey,
  });

  // Update global state with the returned user (includes fresh presigned GET URL)
  store.setUser(updated);
}
```

6. Handle edge cases:
   - File > 5 MB → reject before Step 1, show inline error.
   - Non-image MIME type → reject before Step 1.
   - S3 PUT fails → show error, do not proceed to Step 3.
   - Step 3 fails → inform user the key was not saved (they can retry).

### Phase 3 — Polish

1. Optimistically replace the avatar preview with the local object URL immediately on save.
2. After Step 3 succeeds, replace the object URL with the presigned GET URL from the response.
3. Add a loading skeleton to the avatar while the profile initially loads.
4. Refresh `GET /auth/profile` on app focus if the user has been away for > 10 minutes (to renew the presigned GET URL).

---

## ✅ Success Criteria

### Must Have

- [ ] 3-step upload flow works end to end (presigned URL → S3 PUT → PATCH profile).
- [ ] Nickname-only update works without touching the picture.
- [ ] Updated picture appears in the navbar immediately after save.
- [ ] Nickname overrides full name display when set; clears correctly on empty string.

### Should Have

- [ ] Client-side file type and size validation before requesting the upload URL.
- [ ] Local image preview shown immediately after file selection.
- [ ] Loading state on the Save button during the upload.
- [ ] Error handling at each step with user-friendly messages.

### Nice to Have

- [ ] Crop/resize image client-side before upload (e.g. via `canvas` or a crop library).
- [ ] Avatar removal — send `profilePictureKey: null` to clear the picture.
