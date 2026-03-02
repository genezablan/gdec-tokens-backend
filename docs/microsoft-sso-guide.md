# 🔷 Frontend Implementation Guide: Sign In with Microsoft

## 📋 Project Brief

Allow employees to sign in using their **Microsoft (Azure AD) work account** via OAuth 2.0. The backend handles the entire OAuth flow — the frontend just redirects the browser to the backend's Microsoft auth endpoint and receives a JWT on success.

This is a **redirect-based flow** — no PKCE or token exchange needed on the frontend.

---

## 🎯 API Endpoints

**Base URL:** `https://tokens-staging.greatdealscorp.com/api`

| Method | Endpoint                   | Purpose                                         | Auth Required |
| ------ | -------------------------- | ----------------------------------------------- | ------------- |
| `GET`  | `/auth/microsoft`          | Redirect browser here to initiate Microsoft SSO | No            |
| `GET`  | `/auth/microsoft/callback` | Backend-only — handles Azure AD callback        | No (internal) |

> **Backend base URL (CloudFront → EC2):** `https://d3oagholm1a2ta.cloudfront.net/api`
> **Frontend URL:** `https://tokens-staging.greatdealscorp.com`

> **Note:** `/auth/microsoft/callback` is called by Microsoft directly — never call it from frontend code.

---

## 📝 Important Notes

- The employee **must already exist** in the system (imported by HR). Microsoft SSO links to the existing account by email. If no match is found, they are redirected to an error page.
- After successful login, the backend redirects to the frontend with a **JWT access token** in the URL query param. The frontend must extract it and store it like any other login token.
- The `isPasswordChanged` flag is irrelevant for SSO users — they will not be prompted to change their password.
- SSO login does **not** require a password. Employees with both a local password and a Microsoft account can use either method.
- The JWT returned has the same structure and expiry as a regular login token (7 days).

---

## 🔄 Full Flow

```
1. User clicks "Sign in with Microsoft" button
       │
       ▼
2. Frontend redirects browser to:
   https://tokens-staging.greatdealscorp.com/api/auth/microsoft
       │
       ▼
3. Backend redirects to Microsoft login page (Azure AD)
       │
       ▼
4. Employee signs in with their @greatdealscorp.com Microsoft account
       │
       ▼
5. Microsoft redirects to backend callback:
   /api/auth/microsoft/callback
       │
       ├── ✅ Account found by email → JWT issued
       │         └── Redirect to frontend:
       │             https://tokens-staging.greatdealscorp.com/auth/callback?token=<jwt>
       │
       └── ❌ No matching account → Redirect to frontend:
                 https://tokens-staging.greatdealscorp.com/auth/error?message=Account+not+found.+Please+contact+HR.

> **Note:** The OAuth callback (`/api/auth/microsoft/callback`) goes to the **backend** (CloudFront → EC2),
> not the frontend. The frontend only receives the final redirect after the backend completes the OAuth dance.
```

---

## 🖥️ Frontend Implementation

### 1. "Sign in with Microsoft" Button

On the login page, add a button that redirects the browser (not an API call — a full navigation):

```typescript
function handleMicrosoftLogin() {
  // Full redirect — not fetch/axios
  window.location.href =
    'https://tokens-staging.greatdealscorp.com/api/auth/microsoft';
}
```

```html
<button onClick="{handleMicrosoftLogin}">Sign in with Microsoft</button>
```

> Use `window.location.href` — **not** `fetch()` or `axios`. The browser must follow the OAuth redirects.

---

### 2. Callback Page (`/auth/callback`)

Create a page at `/auth/callback`. The backend redirects here after successful Microsoft login with `?token=<jwt>`.

```typescript
// /auth/callback page

useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');

  if (!token) {
    // No token — redirect to login with error
    navigate('/login?error=Authentication+failed');
    return;
  }

  // Store the token (same as regular login)
  localStorage.setItem('accessToken', token);

  // Fetch the user profile to populate app state
  fetch('https://tokens-staging.greatdealscorp.com/api/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  })
    .then((res) => res.json())
    .then((user) => {
      // Store user in state management (Zustand, Redux, Context, etc.)
      setUser(user);
      navigate('/dashboard');
    })
    .catch(() => navigate('/login?error=Failed+to+load+profile'));
}, []);

// Show a loading spinner while processing
return <LoadingSpinner message="Signing you in..." />;
```

---

### 3. Error Page (`/auth/error`)

Create a page at `/auth/error`. The backend redirects here if the Microsoft account email doesn't match any system user.

```typescript
// /auth/error page

const params = new URLSearchParams(window.location.search);
const message = params.get('message') || 'An error occurred during sign in.';

return (
  <div>
    <h2>Sign In Failed</h2>
    <p>{message}</p>
    <p>If you believe this is a mistake, please contact HR.</p>
    <a href="/login">Back to Login</a>
  </div>
);
```

---

## 📐 Token Response

The JWT returned via the callback URL is identical to what `POST /auth/login` returns. After storing it, call `GET /auth/me` to get the full user profile:

```typescript
// GET /auth/me response
{
  id: string;
  employeeId: string;
  email: string;
  firstName: string;
  lastName: string;
  department: string;
  position: string;
  roles: string[];
  isPasswordChanged: boolean;
}
```

---

## 🌐 Redirect URLs by Environment

| Environment   | Microsoft Auth URL (backend)                               | Azure AD Redirect URI (backend callback)                            | Frontend receives redirect at                             |
| ------------- | ---------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------- |
| **Local dev** | `http://localhost:3000/api/auth/microsoft`                 | `http://localhost:3000/api/auth/microsoft/callback`                 | `http://localhost:5173/auth/callback`                     |
| **Staging**   | `https://d3oagholm1a2ta.cloudfront.net/api/auth/microsoft` | `https://d3oagholm1a2ta.cloudfront.net/api/auth/microsoft/callback` | `https://tokens-staging.greatdealscorp.com/auth/callback` |

> The Azure AD **Redirect URI** must point to the **backend** (CloudFront URL), not the frontend.
> The `MICROSOFT_CALLBACK_URL` env var on EC2 must be set to the backend CloudFront callback URL.

---

## ✅ Success Criteria

### Must Have

- [ ] "Sign in with Microsoft" button on the login page
- [ ] `/auth/callback` page extracts `token` from URL, stores it, fetches user profile, navigates to dashboard
- [ ] `/auth/error` page shows the error message with a link back to login

### Should Have

- [ ] Loading spinner on `/auth/callback` while processing
- [ ] Clean URL after storing token (use `history.replaceState` to remove `?token=...`)

### Nice to Have

- [ ] Microsoft-branded button (blue with Microsoft logo) following [Microsoft brand guidelines](https://docs.microsoft.com/en-us/azure/active-directory/develop/howto-add-branding-in-azure-ad-apps)
