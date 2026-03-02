# Google SSO Setup Guide

This guide is for the admin who needs to register the GDEC Tokens app in Google Cloud Console and generate OAuth 2.0 credentials for local, staging, and production environments.

> **Note:** The backend code is already written. You only need to complete this setup, add the environment variables, and enable the strategy in `auth.module.ts`.

---

## Step 1 — Create or Select a Google Cloud Project

1. Go to [https://console.cloud.google.com](https://console.cloud.google.com)
2. In the top navigation bar, click the project dropdown → **New Project**
3. Fill in:
   - **Project name**: `GDEC Tokens`
   - **Organization**: select your organization if available
4. Click **Create**
5. Make sure the new project is selected in the top dropdown before proceeding

---

## Step 2 — Enable the Google OAuth API

1. In the left sidebar, go to **APIs & Services → Library**
2. Search for **Google Identity** or **People API**
3. Click on **Google People API** → click **Enable**

> This is needed for profile data (name, email). If you only need email, this step is optional but recommended.

---

## Step 3 — Configure the OAuth Consent Screen

1. Go to **APIs & Services → OAuth consent screen**
2. Choose **Internal** (employees only — recommended for an internal tool)
   - If your Google Workspace does not allow Internal, choose **External** and add test users
3. Click **Create**
4. Fill in the required fields:
   - **App name**: `GDEC Tokens`
   - **User support email**: your admin email (e.g. `it@greatdealscorp.com`)
   - **Developer contact information**: same email
5. Click **Save and Continue**
6. On the **Scopes** screen, click **Add or Remove Scopes** and add:
   - `openid`
   - `email`
   - `profile`
7. Click **Update → Save and Continue**
8. Review the summary, then click **Back to Dashboard**

---

## Step 4 — Create OAuth 2.0 Credentials

1. Go to **APIs & Services → Credentials**
2. Click **+ Create Credentials → OAuth client ID**
3. Fill in:
   - **Application type**: `Web application`
   - **Name**: `GDEC Tokens Backend`
4. Under **Authorized redirect URIs**, click **+ Add URI** and add each environment's callback URL:

   **Local development:**

   ```
   http://localhost:3000/api/auth/google/callback
   ```

   **Staging:**

   ```
   https://d3oagholm1a2ta.cloudfront.net/api/auth/google/callback
   ```

   **Production:** _(add when production is ready)_

   ```
   https://<production-cloudfront-domain>/api/auth/google/callback
   ```

5. Click **Create**

---

## Step 5 — Copy the Credentials

After clicking Create, a dialog will show your credentials:

| Field         | Variable name          |
| ------------- | ---------------------- |
| Client ID     | `GOOGLE_CLIENT_ID`     |
| Client secret | `GOOGLE_CLIENT_SECRET` |

**Copy both values immediately.** You can also retrieve them later from **APIs & Services → Credentials** by clicking the pencil icon on the credential.

> ⚠️ Store them securely. Do NOT commit them to Git.

---

## Step 6 — Set the Environment Variables

### Local Development (`.env`)

```env
GOOGLE_CLIENT_ID=<Client ID from Step 5>
GOOGLE_CLIENT_SECRET=<Client secret from Step 5>
GOOGLE_CALLBACK_URL=http://localhost:3000/api/auth/google/callback
```

### Staging (EC2 `.env`)

SSH into the staging server and edit `~/gdec-tokens-backend/.env`:

```bash
ssh -i ~/.ssh/gdec-tokens.pem ubuntu@ec2-3-1-79-100.ap-southeast-1.compute.amazonaws.com
nano ~/gdec-tokens-backend/.env
```

Add:

```env
GOOGLE_CLIENT_ID=<Client ID from Step 5>
GOOGLE_CLIENT_SECRET=<Client secret from Step 5>
GOOGLE_CALLBACK_URL=https://d3oagholm1a2ta.cloudfront.net/api/auth/google/callback
```

Then reload the app:

```bash
pm2 reload gdec-tokens-backend-staging --update-env
```

### Production (EC2 `.env`) _(when ready)_

```env
GOOGLE_CLIENT_ID=<same client ID — shared across environments>
GOOGLE_CLIENT_SECRET=<same or separate secret>
GOOGLE_CALLBACK_URL=https://<production-cloudfront-domain>/api/auth/google/callback
```

---

## Step 7 — Enable the Strategy in the Backend

Once credentials are in `.env`, uncomment the `GoogleStrategy` in `src/auth/auth.module.ts`:

```typescript
// Before:
// import { GoogleStrategy } from './strategies/google.strategy';
// ...
// providers: [AuthService, JwtStrategy, LocalStrategy, MicrosoftStrategy /*, GoogleStrategy */]

// After:
import { GoogleStrategy } from './strategies/google.strategy';
// ...
providers: [
  AuthService,
  JwtStrategy,
  LocalStrategy,
  MicrosoftStrategy,
  GoogleStrategy,
];
```

Then also uncomment (or verify) the Google auth routes in `src/auth/auth.controller.ts`:

```typescript
@Get('google')
@Public()
@UseGuards(GoogleAuthGuard)
googleLogin() {}

@Get('google/callback')
@Public()
@UseGuards(GoogleAuthGuard)
async googleCallback(@Req() req, @Res() res) {
  // handled by the controller — returns JWT redirect
}
```

---

## Step 8 — Test the Flow

### Local

1. Make sure `npm run start:dev` is running
2. Open in browser: `http://localhost:3000/api/auth/google`
3. Sign in with a Google account whose **email matches a record in the `users` table**
4. On success → redirected to `http://localhost:3000/auth/callback?token=<jwt>`
5. If the email is not in the DB → redirected to `http://localhost:3000/auth/error?message=Account+not+found.+Please+contact+HR.`

### Staging

Same flow but use:

- Login URL: `https://d3oagholm1a2ta.cloudfront.net/api/auth/google`
- Success redirect: `https://tokens-staging.greatdealscorp.com/auth/callback?token=<jwt>`
- Error redirect: `https://tokens-staging.greatdealscorp.com/auth/error?message=...`

---

## Summary of Environment Variables

| Variable               | Description                                            |
| ---------------------- | ------------------------------------------------------ |
| `GOOGLE_CLIENT_ID`     | OAuth 2.0 client ID from Google Cloud Console          |
| `GOOGLE_CLIENT_SECRET` | OAuth 2.0 client secret from Google Cloud Console      |
| `GOOGLE_CALLBACK_URL`  | Full URL of the callback endpoint for this environment |

---

## Notes

- **The app does NOT auto-create users.** If an employee signs in with Google but their email is not in the `users` table, they will be blocked with an error. All users must be pre-imported by HR/admin.
- **One OAuth client ID is shared across all environments** — just add all environment callback URLs to the same credential's Authorized Redirect URIs.
- **Internal vs External consent screen:** If you chose External during Step 3, you must add each employee's Gmail/Workspace email as a test user until the app is published.
- **Google Workspace restriction (recommended):** On the OAuth consent screen, under **Advanced settings**, you can restrict sign-in to your company's Workspace domain (e.g. `greatdealscorp.com`) so only company accounts can attempt login.
