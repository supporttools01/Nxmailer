# Send mail now — v1.2.0

Windows desktop SMTP emailer for authorized customer communications, with an iOS-inspired premium interface.

## Included
- Local administrator / company-agent login
- Admin-only agent and SMTP management
- Multiple generic standards-compliant SMTP host + port profiles
- SMTP Pool: select multiple enabled SMTP accounts for one campaign
- Configurable batch rotation (default 50 recipients per SMTP before moving to the next)
- Per-SMTP provider-approved rolling-hour cap; accounts at their cap are skipped until quota becomes available
- Campaign status changes to `waiting_quota` when every selected SMTP has reached its configured hourly allowance
- Per-recipient SMTP attribution in delivery logs and Excel exports
- SSL/TLS and STARTTLS support
- OS-backed encrypted SMTP passwords through Electron `safeStorage` on packaged Windows builds
- SMTP connection/authentication test using the values currently shown in the edit form
- Excel / CSV customer import (`.xlsx`, `.xls`, `.csv`)
- Automatic personalization tags generated from file headers
- Local SQLite customer database
- Personalized subject and HTML body merge (`{{customer_name}}`, `{{renewal_date}}`, etc.)
- CC / BCC and saved templates
- Attachments
- Sandboxed merged-email preview
- Recipient authorization confirmation
- Suppression list
- Duplicate and invalid recipient skipping
- Sequential send queue with configurable 1–60 second delay
- Pause / resume / cancel while the current app session is running
- Interrupted-campaign recovery status after an unexpected app restart
- Delivery / skipped / failed logs
- Excel campaign report export
- iOS-inspired glass UI with rounded cards, SF-system typography and Apple-style interaction patterns
- GitHub Actions workflow for a Windows `.exe` NSIS installer

## SMTP Pool example
With SMTP A, B and C selected and `Emails per SMTP batch = 50`:

- recipients 1–50 → SMTP A
- recipients 51–100 → SMTP B
- recipients 101–150 → SMTP C
- next batch returns to SMTP A only if its configured rolling-hour allowance still has capacity

The hourly cap field should be set to the allowance approved/documented by the SMTP provider. The pool is intended to distribute authorized workload, not bypass provider restrictions.

## Development
```bash
npm install
npm run dev
```

## Windows installer
On Windows:
```bash
npm install
npm run dist:win
```

Expected output:
`release/Send-mail-now-Setup-1.2.0.exe`

Or push the source to a private GitHub repository and run **Build Windows Installer** from GitHub Actions.

## SMTP compatibility
The current build supports standards-compliant SMTP using host, port, username/password (or no authentication), SSL/TLS, or STARTTLS. Providers that require OAuth-only SMTP authentication need a separate OAuth integration.

## Security notes
- Live SMTP secrets are not stored in source code.
- In packaged Windows builds, SMTP passwords require Electron OS secure storage.
- HTML previews run inside a sandboxed iframe so email HTML cannot directly access the Electron bridge.
- SMTP and agent management are administrator-only.
- Clearing the complete local customer database is administrator-only.
- Keep the repository private and do not commit real customer lists or credentials.

This software is intended for transactional/customer communication and permission-based campaigns. Follow SMTP-provider rules and applicable consent, unsubscribe, privacy, and anti-spam requirements.
