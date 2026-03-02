# Microsoft SSO Setup Guide

This guide is for the Azure AD admin who needs to register the GDEC Tokens app and generate credentials for local, staging, and production environments.

---

## Step 1 — Register the App in Azure AD

1. Go to [https://portal.azure.com](https://portal.azure.com)
2. Search for **App registrations** in the top search bar → click it
3. Click **+ New registration**
4. Fill in:
   - **Name**: `GDEC Tokens`
   - **Supported account types**: `Accounts in this organizational directory only (Single tenant)`
   - **Redirect URI**: leave blank for now (we'll add them in Step 3)
5. Click **Register**

---

## Step 2 — Copy the IDs

After registration, you will be on the app's Overview page. Copy the following:

| Field                   | Where to find it | Variable name         |
| ----------------------- | ---------------- | --------------------- |
| Application (client) ID | Overview page    | `MICROSOFT_CLIENT_ID` |
| Directory (tenant) ID   | Overview page    | `MICROSOFT_TENANT`    |

---

## Step 3 — Add Redirect URIs

1. In the left sidebar, click **Authentication**
2. Under **Platform configurations**, click **+ Add a platform**
3. Choose **Web**
4. Add the following URIs one by one (click **Add URI** for each):

   **Local development:**

   ```
   http://localhost:3000/api/auth/microsoft/callback
   ```

   **Staging:**

   ```
   https://d3oagholm1a2ta.cloudfront.net/api/auth/microsoft/callback
   ```

   **Production:** _(add when production is ready)_

   ```
   https://<production-cloudfront-domain>/api/auth/microsoft/callback
   ```

5. Under **Implicit grant and hybrid flows**, leave everything **unchecked**
6. Click **Save**

---

## Step 4 — Create a Client Secret

1. In the left sidebar, click **Certificates & secrets**
2. Click **+ New client secret**
3. Fill in:
   - **Description**: `GDEC Tokens Backend`
   - **Expires**: `24 months` (or per company policy)
4. Click **Add**
5. **Copy the secret value immediately** — it will be hidden after you leave the page

This value is your `MICROSOFT_CLIENT_SECRET`.

> ⚠️ Store it securely. Do NOT commit it to Git.

---

## Step 5 — Add API Permissions (Optional but Recommended)

1. In the left sidebar, click **API permissions**
2. Click **+ Add a permission → Microsoft Graph → Delegated permissions**
3. Search for and add:
   - `User.Read` (should already be there by default)
4. Click **Grant admin consent for [your organization]** → **Yes**

---

## Step 6 — Set the Environment Variables

### Local Development (`.env`)

```env
MICROSOFT_CLIENT_ID=<Application (client) ID from Step 2>
MICROSOFT_CLIENT_SECRET=<Secret value from Step 4>
MICROSOFT_TENANT=<Directory (tenant) ID from Step 2>
MICROSOFT_CALLBACK_URL=http://localhost:3000/api/auth/microsoft/callback
```

### Staging (EC2 `.env`)

SSH into the staging server and edit `~/gdec-tokens-backend/.env`:

```bash
ssh -i ~/.ssh/gdec-tokens.pem ubuntu@ec2-3-1-79-100.ap-southeast-1.compute.amazonaws.com
nano ~/gdec-tokens-backend/.env
```

Add:

```env
MICROSOFT_CLIENT_ID=<Application (client) ID from Step 2>
MICROSOFT_CLIENT_SECRET=<Secret value from Step 4>
MICROSOFT_TENANT=<Directory (tenant) ID from Step 2>
MICROSOFT_CALLBACK_URL=https://d3oagholm1a2ta.cloudfront.net/api/auth/microsoft/callback
```

Then reload the app:

```bash
pm2 reload gdec-tokens-backend-staging --update-env
```

### Production (EC2 `.env`) _(when ready)_

Same as staging but use the production CloudFront domain and production EC2.

```env
MICROSOFT_CLIENT_ID=<same client ID — shared across environments>
MICROSOFT_CLIENT_SECRET=<same or separate secret>
MICROSOFT_TENANT=<same tenant ID>
MICROSOFT_CALLBACK_URL=https://<production-cloudfront-domain>/api/auth/microsoft/callback
```

---

## Step 7 — Test the Flow

### Local

1. Make sure `npm run start:dev` is running
2. Open in browser: `http://localhost:3000/api/auth/microsoft`
3. Sign in with a Microsoft account that has an email matching a record in the `users` table
4. On success → redirected to `http://localhost:3000/auth/callback?token=<jwt>`
5. If the email is not in the DB → redirected to `http://localhost:3000/auth/error?message=Account+not+found.+Please+contact+HR.`

### Staging

Same as above but use:

- Login URL: `https://d3oagholm1a2ta.cloudfront.net/api/auth/microsoft`
- Success redirect: `https://tokens-staging.greatdealscorp.com/auth/callback?token=<jwt>`
- Error redirect: `https://tokens-staging.greatdealscorp.com/auth/error?message=...`

---

## Summary of Environment Variables

| Variable                  | Description                                               |
| ------------------------- | --------------------------------------------------------- |
| `MICROSOFT_CLIENT_ID`     | Azure app's Application (client) ID                       |
| `MICROSOFT_CLIENT_SECRET` | Azure app's client secret value                           |
| `MICROSOFT_TENANT`        | Azure Directory (tenant) ID — use tenant ID, not `common` |
| `MICROSOFT_CALLBACK_URL`  | Full URL of the callback endpoint for this environment    |

---

## Notes

- **The app does NOT auto-create users.** If an employee signs in with Microsoft but their email is not in the `users` table, they will be blocked with an error. All users must be pre-imported by HR/admin.
- **One Azure app registration is shared across all environments** — just add each environment's callback URL to the same app's Authentication page.
- **Client secrets expire.** Set a calendar reminder before the expiry date to rotate the secret and update all `.env` files.
