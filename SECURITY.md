# Security

This early release is intended for one trusted studio per instance, not mutually untrusted tenants sharing a database.
Only the latest release receives fixes until a supported-version policy is announced. There is no response-time SLA.

## Reporting

Use the repository’s **Security → Report a vulnerability** private reporting feature when enabled.
If unavailable, open a minimal issue asking for a private reporting channel, **without exploit details,
photos, invitation links, tokens, account information or databases**. A private contact must be configured
before inviting public users; no fictional security email is provided here.

Include the affected version, impact, safe reproduction using synthetic data and suggested mitigation privately.
Do not test instances you do not own or disclose private records in CI logs or issue attachments.

## Operator responsibilities

Keep setup closed except during private first-owner creation. Use HTTPS, a durable random `APP_SECRET`,
a private storage bucket and least-privilege credentials. Protect the database, `.env`, media and backups.
Do not trust arbitrary proxy forwarding headers or expose the Docker socket to the application.
Follow the documented upgrade and restore procedures; never run two app processes on one database.

The shipped checks are regression coverage, not an independent security audit or a compliance certification.
