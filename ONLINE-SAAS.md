# Send Mail Now — Online SaaS

The `online-saas` branch hosts the customer workspace in the separate Supabase project `qismpexnxgwisyjjepyt`. Customer authentication and tenant data are backed by Supabase Auth and row-level security (RLS).

## Features currently implemented

- Customer signup, sign-in, sign-out, and password reset
- Customer-owned contacts, campaign drafts, templates, and profile
- Owner-only Super Admin UI for user listing and subscription changes
- Admin role protected by database privileges and the server-checked subscription RPC
- Encrypted Resend API credential storage using Supabase Vault
- Server-side campaign sender Edge Function with account ownership checks, active-subscription enforcement, suppression filtering, monthly allowance and hourly cap checks, batch sending, recipient status updates, and event logs
- Windows desktop wrapper that opens the hosted workspace in a hardened Electron window

## Deployment

- Static site deployment workflow: `.github/workflows/deploy-online-saas.yml`
- Expected public URL: https://supporttools01.github.io/Nxmailer/
- Windows installer build workflow: `.github/workflows/build-online-desktop.yml`
- Desktop installer uses Electron with context isolation, Node integration disabled, and navigation restricted to the hosted workspace origin.

## Email delivery setup required

The online workspace sends through the Resend HTTPS API (not raw SMTP) because serverless Edge Functions do not provide a reliable general-purpose outbound SMTP socket. In **Account & SMTP**, configure a Resend API key and a sender address on a domain verified in Resend. The key is stored in Supabase Vault and is never returned to the browser after saving. The owner must also assign an active subscription and a monthly allowance before a customer can send.

The online sender processes campaigns in small batches. The user must click **Send campaign** and confirm they have permission to contact the recipients. Only unsuppressed contacts are queued. Do not send unsolicited mail; configure consent and unsubscribe handling appropriate to your jurisdiction and provider policy.

## Security

- No service-role key is embedded in the browser or repository.
- RLS isolates customer data.
- Public signup always creates a customer; it cannot create an admin.
- Authenticated users cannot update profile role/email or write directly to SMTP credential metadata.
- SMTP/API secrets are stored in Supabase Vault and retrieved by a service-role-only RPC for server-side sending.
- Never commit provider keys or customer lists.

## Known items that still require owner setup and end-to-end validation

- A real Resend API key and verified sender domain must be entered by the owner.
- A paid/trial subscription and sending allowance must be assigned before sending can run.
- Actual provider acceptance/delivery has not been test-sent yet.
- GitHub Pages and Windows installer workflows must be checked after every deployment change.
