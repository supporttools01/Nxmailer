# Send Mail Now — Online SaaS scaffold

This branch adds a browser workspace backed by the separate Supabase project `send mail now` (`qismpexnxgwisyjjepyt`). It includes Supabase Auth, customer-isolated contacts/campaign drafts/templates, and a role-gated subscription admin screen.

## Current limitations
- Email sending is intentionally disabled until a protected server-side SMTP sender and encrypted credential vault are configured and tested.
- The first owner account must be explicitly promoted to admin by a trusted project owner after confirming the exact owner email. Never make the first public signup an automatic admin.
- The Electron desktop source remains in the existing encoded archive workflow; this branch adds a hosted web workspace.

## Deployment
Deploy the `online-saas` branch as a static site (root directory, no build command; output directory is the repository root). Supabase URL and publishable key are public client configuration; never add a Supabase secret/service-role key to this repository.

## Security
All user data tables have RLS. Customer policies constrain records to `auth.uid()`. Subscription changes use a server-checked admin RPC. The admin UI is a convenience layer, not the security boundary; RLS and the RPC enforce access.
