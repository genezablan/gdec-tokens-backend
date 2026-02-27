# 👤 Frontend Implementation Guide: User Profile

## 📋 Project Brief

Allow employees to personalise their account by setting a **display nickname** and uploading a **profile picture**.
Both are optional — if unset, the frontend should fall back to the employee's full name and a default avatar.

- Profile picture is uploaded directly via the API as a `multipart/form-data` request and stored in AWS S3 (`profile-pictures/<userId>/` prefix).
- Nickname is a free-text string (max 50 characters).
- Both fields can be updated independently or together in a single request.
- Uses the existing `PATCH /auth/profile` endpoint — **JWT required**.

---

## 🎯 Backend API Endpoints

**Base URL:** `http://localhost:3000/api`

| Method  | Endpoint        | Purpose                                        | Auth Required |
| ------- | --------------- | ---------------------------------------------- | ------------- |
| `GET`   | `/auth/profile` | Get current user profile (includes all fields) | Yes           |
| `PATCH` | `/auth/profile` | Update nickname and/or profile picture         | Yes           |

---

## ⚠️ Important Notes

- `PATCH /auth/profile` accepts **`multipart/form-data`** (not JSON) because it handles file uploads.
- The file field name **must** be `profilePicture`.
- Accepted image types: `image/jpeg`, `image/png`, `image/webp` (client-side validation recommended; backend accepts any MIME type).
- Max recommended file size: **5 MB** (enforce client-side).
- Both `nickname` and `profilePicture` are optional in each request — send only what changed.
- To **clear** the nickname, send `nickname` as an empty string — the API stores it as `null`.
- The S3 bucket is **private**. The returned `profilePicture` value is a **pre-signed GET URL valid for 15 minutes** — do not cache it beyond that window.
- Re-fetch `GET /auth/profile` (or call the endpoint again) to get a fresh signed URL when displaying the avatar after the window has expired.
- The `GET /auth/profile` response includes `immediateSupervisor` relation; `GET /auth/me` does not.

---

## 📐 Data Models

### User (profile response fields relevant to this feature)

```typescript
interface UserProfile {
  id: string;
  employeeId: string; // e.g. "GDC-001"
  email: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  nickname: string | null; // ← new: display name override
  profilePicture: string | null; // ← new: full S3 URL
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

### PATCH request (multipart/form-data)

| Field            | Type   | Required | Notes                      |
| ---------------- | ------ | -------- | -------------------------- |
| `nickname`       | string | No       | Max 50 chars               |
| `profilePicture` | File   | No       | Image file (JPEG/PNG/WEBP) |

---

## 🧪 Curl Test Commands

### Get current profile

```bash
curl -X GET http://localhost:3000/api/auth/profile \
  -H "Authorization: Bearer <token>"
```

### Update nickname only

```bash
curl -X PATCH http://localhost:3000/api/auth/profile \
  -H "Authorization: Bearer <token>" \
  -F "nickname=Mo"
```

### Upload profile picture only

```bash
curl -X PATCH http://localhost:3000/api/auth/profile \
  -H "Authorization: Bearer <token>" \
  -F "profilePicture=@/path/to/photo.jpg"
```

### Update nickname and picture together

```bash
curl -X PATCH http://localhost:3000/api/auth/profile \
  -H "Authorization: Bearer <token>" \
  -F "nickname=Mo" \
  -F "profilePicture=@/path/to/photo.jpg"
```

### Clear nickname

```bash
curl -X PATCH http://localhost:3000/api/auth/profile \
  -H "Authorization: Bearer <token>" \
  -F "nickname="
```

---

## 🖥️ Frontend Requirements

### Profile Page / Settings Page

- Display the employee's current profile picture (or a default avatar placeholder if `profilePicture` is `null`).
- Display the current nickname in an editable input (or placeholder text like `"Add a nickname…"` if `null`).
- **Avatar upload button** — clicking opens the system file picker (accept `image/*`).
  - Show a local preview (`URL.createObjectURL`) immediately after selection.
  - Upload is triggered on save (not immediately on file pick).
- **Nickname input** — plain text input, max 50 characters.
- A single **Save Changes** button submits both fields together.
- Show a loading state on the save button while the request is in-flight.
- On success: show a success toast/notification and update the profile picture and nickname everywhere they appear (navbar avatar, sidebar, etc.).
- On error: show an error message.

### Navbar / Header Avatar

- Show `profilePicture` URL if set, else show initials avatar (first + last initial).
- Clicking the avatar can navigate to the Profile/Settings page.

### Display Name Logic

Use this priority order throughout the app when showing the user's name:

1. `nickname` (if not null/empty)
2. `firstName + ' ' + lastName`

```typescript
function getDisplayName(user: UserProfile): string {
  return user.nickname?.trim() || `${user.firstName} ${user.lastName}`;
}
```

---

## 🛠️ Implementation Steps

### Phase 1 — Fetch and Display

1. On app load (after login), call `GET /auth/profile` and cache the result in global state (Pinia/Zustand/Context).
2. Render `profilePicture` in the navbar avatar. Fall back to initials if `null`.
3. Use `getDisplayName()` everywhere a name is displayed.

### Phase 2 — Profile Edit Form

1. Create a **Profile Settings** page/modal.
2. Pre-fill the nickname input with `user.nickname ?? ''`.
3. Show the current profile picture with an overlay upload button.
4. On file select: create a local object URL for preview only.
5. On **Save Changes**:
   - Build a `FormData` object. Only append `nickname` if the value differs from the current value; only append `profilePicture` if a new file was picked.
   - POST via `multipart/form-data` to `PATCH /auth/profile`.
   - On success: update the global user state with the returned user object.
6. Handle edge cases:
   - File > 5 MB: reject before upload, show inline error.
   - Non-image file type: reject before upload.
   - Network error: show retry option.

### Phase 3 — Polish

1. Add loading skeleton to the avatar while the profile loads.
2. Optimistically update the avatar preview immediately on save (even before the API responds).
3. On the confirmation that the upload succeeded, replace the object URL with the permanent S3 URL from the response.

---

## ✅ Success Criteria

### Must Have

- [ ] `PATCH /auth/profile` with `multipart/form-data` works for nickname and/or picture.
- [ ] Updated profile picture appears in the navbar immediately after save.
- [ ] Nickname appears in place of full name when set.
- [ ] Clearing nickname (empty string) reverts display to full name.

### Should Have

- [ ] Client-side file type and size validation before upload.
- [ ] Local image preview before submitting.
- [ ] Loading state on the save button.

### Nice to Have

- [ ] Crop/resize the image client-side before uploading (e.g. via `canvas` or a crop library).
- [ ] Avatar removal button that sends `profilePicture` as null to reset to initials.
