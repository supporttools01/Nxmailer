# Gmail API setup for Send Mail Now

The Gmail API OAuth functions are deployed, but they require an OAuth client owned by the Send Mail Now owner. Do not commit OAuth credentials to this repository.

## 1. Create the Google OAuth client

1. Open https://console.cloud.google.com/ and select or create a Google Cloud project.
2. Enable **Gmail API** for the project.
3. Configure the OAuth consent screen. If the app is in Testing mode, add the Google accounts that should be allowed to connect as test users.
4. Create an OAuth client ID of type **Web application**.
5. Add this exact **Authorized redirect URI**:

   `https://qismpexnxgwisyjjepyt.supabase.co/functions/v1/gmail-oauth-callback`

6. Copy the OAuth **Client ID** and **Client secret**.

Google may require consent-screen verification before the Gmail sending scope can be used by the public.

## 2. Add the client credentials to Supabase

In the Supabase dashboard for project `qismpexnxgwisyjjepyt`, open **Edge Functions → Secrets** and add:

- `GOOGLE_CLIENT_ID` = the Web OAuth client ID
- `GOOGLE_CLIENT_SECRET` = the Web OAuth client secret

Do not put these values in `index.html`, GitHub, or any public client bundle. The existing Supabase service-role secret is already supplied by the Edge Functions runtime and must remain private.

## 3. Verify

1. Open https://supporttools01.github.io/Nxmailer/
2. Sign in to Send Mail Now.
3. Open **Account & SMTP → Gmail API** and select **Connect Gmail account**.
4. Approve the Google consent screen.
5. Return to the workspace and verify the connected Google email appears.
6. Use **Test connection** from the sending UI (or test sender) before sending a campaign.

The app stores OAuth access/refresh credentials in Supabase Vault, refreshes access tokens server-side, and sends using the Gmail API. Gmail's own sending limits and Google's OAuth verification policies still apply.
