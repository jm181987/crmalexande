# Alexandre CRM — Español / Português / English

Starter CRM web app using React, Express and PostgreSQL.

## Implemented
- Login with bcrypt password hashes and HTTP-only session JWT.
- Company-based access isolation; owner, manager and agent roles.
- Dashboard: leads, open opportunity value, closed revenue, conversations, pending tasks.
- Contacts with search and tags; database has JSON custom fields.
- Visual Kanban pipelines, stage totals, drag & drop; loss reason is required.
- Conversations and private internal notes (**these do not send actual WhatsApp messages**).
- Tasks, calendar appointments with overlap check, and user creation.
- Spanish, Portuguese and English interface with responsive desktop/mobile layout.

## Dependencies & configuration
Node.js >=20 and a reachable PostgreSQL database. **No real passwords should ever be committed.**

Set runtime environment variables (see `.env.example`):
```
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DBNAME
DATABASE_SSL=false
JWT_SECRET=GENERATE_A_LONG_RANDOM_SECRET
COOKIE_SECURE=true
PORT=3001
ADMIN_EMAIL=owner@example.com
ADMIN_PASSWORD=A_STRONG_UNIQUE_12_PLUS_CHARACTER_PASSWORD
```

`DATABASE_URL` must only exist in private deployment secrets, never in client-side variables. Use `DATABASE_SSL=true` when the PostgreSQL host supports TLS, and configure appropriate certificate validation.

## Install / run

```bash
npm install
npm run db:migrate
npm run build
NODE_ENV=production npm start
```

The first migration creates the schema and, if the database has no CRM users, creates the first owner and default pipeline with `ADMIN_EMAIL` / `ADMIN_PASSWORD`. Remove `ADMIN_PASSWORD` after successful bootstrap. The app serves the built frontend via the Express server. Health: `GET /api/health`.

For development, start `npm start` and `npm run dev` in two terminals; Vite proxies `/api` requests to port 3001.

## Planned next modules
**Not yet implemented and not to be confused with working integrations:** WhatsApp Cloud API, Instagram Direct, Messenger, SMS, email, site webchat, AI conversation agent/knowledge ingestion, Meta and Google lead ads, campaign sending, follow-up and SLA workflows, Google/Outlook sync, external review platforms, file attachments, advanced smart lists, and complete reporting.

These need provider API credentials and permissions, verified webhooks, outbound opt-in checks, rate limiting, background job workers, secure file storage, audit controls and operational tests. Respect Meta template approvals and WhatsApp messaging windows; comply with applicable privacy and marketing laws.

## Deployment and security
- PostgreSQL on port 5432 should not be publicly exposed without network restrictions. Prefer private host routing and TLS.
- Rotate the database password if it was included in a chat or deployment log.
- Set `COOKIE_SECURE=true` behind HTTPS and a long random `JWT_SECRET`.
- API scopes agent records by ownership and all records by company, not only frontend UI filters.
- Before handling real customer data, add login rate limiting, backup/restore tests, structured audit logging, production migrations, full input validation, CSRF protection as needed, data retention controls and monitored job queues.

## Phase 2 modules (Vercel-compatible)
- Contact editing and filtering by source and tags.
- Reports for pipeline stages, team, lead sources, won opportunities and tasks.
- Automation rule registry with enable/disable switches. **Rules are not yet executed automatically**; a durable event processor is required.
- Campaign drafts for WhatsApp, email and SMS. **No outbound sending is implemented**.
- AI instructions/modes and knowledge text/HTTPS URL registry. **No model provider or URL ingestion is connected**.
- Review request drafts, and integration status catalog. **No external review requests are sent**.
- Existing opportunities Kanban, internal inbox, calendar and task functionality remains available.

### Mandatory production migration
Run `scripts/modules.sql` once on the existing PostgreSQL database (as a database administrator) before using the new modules, or run `npm run db:migrate` from a secure Node environment with database connectivity. The migration is additive and does not remove existing users or records. On Vercel, redeploy after the migration. New API routes are registered under `/api` and retain company/role scoping.

### Integration prerequisites
Real WhatsApp Cloud API, Instagram/Messenger, SMS, email, Google/Outlook Calendar, Ads, AI model calls and review delivery need provider-specific credentials, verified webhooks, security validation, opt-in/compliance checks, queues and deployment tests. Do not put provider tokens in the integration metadata form or GitHub; store them as Vercel secrets.
