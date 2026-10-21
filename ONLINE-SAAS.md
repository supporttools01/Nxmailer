# Send Mail Now — Online SaaS

The `online-saas` branch hosts the customer workspace in the separate Supabase project `qismpexnxgwisyjjepyt`. Customer authentication and tenant data are backed by Supabase Auth and row-level security (RLS).

## Customer workspace — preserved

The existing `index.html` customer workspace remains intact. Its current customer-facing features are preserved:

- Customer signup, sign-in, sign-out, and password reset
- Customer-owned contacts with tags and Excel/CSV import/export
- Campaign drafts and batch sending
- Reusable HTML templates
- Profile and subscription view
- Customer-owned SMTP sender setup
- Resend API sender setup
- Owner-only Super Admin area and subscription management

No existing desktop-emailer source/build chunks are replaced by the new owner console.

## New owner admin console

A separate polished owner console is available at `/admin.html` when the GitHub Pages site is deployed. It uses the same Supabase project and verifies the signed-in user's `profiles.role` before loading admin data.

Admin console sections:

- Overview — customers, active/trial subscriptions, campaigns, configured senders, and plan mix
- Customers — searchable customer list with subscription management
- Subscriptions — plan, status, start/end date, and monthly allowance
- Campaign activity — operational campaign overview
- API & Sending — Resend API and SMTP capability/status guidance
- System — environment and release notes

The new console is additive: the original customer workspace is not removed or rewritten.

## Email delivery setup

The online workspace sends through the existing server-side sender flow. Resend HTTPS API is supported, with API keys stored in Supabase Vault and never returned to the browser after saving. Customer-owned SMTP credentials are also stored in Vault and retrieved only by the protected sending service.

The owner must assign an active/trial subscription and a monthly allowance before a customer can send. Provider acceptance/delivery still needs an actual test using a verified sender/domain.

## Deployment

- Static site deployment workflow: `.github/workflows/deploy-online-saas.yml`
- Expected public URL: `https://supporttools01.github.io/Nxmailer/`
- Owner console: `https://supporttools01.github.io/Nxmailer/admin.html`
- Windows installer build workflow: `.github/workflows/build-online-desktop.yml`
- Desktop installer uses Electron with context isolation, Node integration disabled, and navigation restricted to the hosted workspace origin.

## Security

- No service-role key is embedded in the browser or repository.
- RLS isolates customer data.
- Public signup always creates a customer; it cannot create an admin.
- Authenticated users cannot update profile role/email or write directly to SMTP credential metadata.
- SMTP/API secrets are stored in Supabase Vault and retrieved by a service-role-only RPC for server-side sending.
- Never commit provider keys or customer lists.

## Validation still required before calling a release production-ready

- Enter a real Resend API key and use a verified sender domain, or configure a customer SMTP sender.
- Assign a real active/trial subscription and allowance.
- Perform an end-to-end provider test send.
- Verify GitHub Pages deployment after the new admin console is published.
- Verify the Windows installer workflow and compare the resulting build against the existing customer emailer before replacing any release artifact.
