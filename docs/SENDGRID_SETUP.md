# SendGrid email configuration

The CRM already sends opted-in email campaigns through SendGrid in `server/campaign-worker.js`. This integration is server-side only; **never** expose the API key through Vite `VITE_*` variables, frontend code, logs, or commits.

## Production environment variables (Vercel)

Set these in the Vercel project's **Settings → Environment Variables** (Production; optionally Preview with a separate SendGrid key):

```env
SENDGRID_API_KEY=<new-rotated-key-with-Mail-Send-permission>
SENDGRID_FROM_EMAIL=notificaciones@grupozarko.com.br
SENDGRID_REPLY_TO=contacto@grupozarko.com.br
```

The sender address is an example; use an address authorized by your verified SendGrid domain. Do not put real credentials in this file.

The API key shared in chat must be revoked and replaced in the SendGrid console before using it in production. After saving variables, redeploy the application.

## Domain authentication

In SendGrid, authenticate `grupozarko.com.br` and publish the **current** DNS records from the SendGrid wizard at the authoritative DNS provider. Do not mix earlier records for `url6745.www` with the newer `url4657` set. Verify the domain in SendGrid before sending. Keep the site's existing A records intact.

## Verify without sending

Log in as an owner or manager and request:

```
GET /api/sendgrid/config-check
GET /api/campaigns/operations/status
```

Both endpoints require a valid authenticated session. They report whether the key and sender are configured without returning secrets. These checks do not validate domain authentication or SendGrid delivery.

## Enable campaign delivery only when ready

Campaign preparation and delivery require opt-in contacts, and the dispatcher requires an explicit worker configuration. Keep `CAMPAIGN_DELIVERY_ENABLED` unset or `false` until the domain is verified, opt-out links are configured, the webhook public key is installed, and the worker has been tested with a controlled opt-in contact.

Relevant optional variables include:

```env
SENDGRID_EVENT_PUBLIC_KEY=<event-webhook-verification-public-key>
CAMPAIGN_UNSUBSCRIBE_SECRET=<random-secret-at-least-32-characters>
PUBLIC_APP_URL=https://www.grupozarko.com.br
CAMPAIGN_WORKER_SECRET=<random-secret-at-least-24-characters>
CAMPAIGN_DELIVERY_ENABLED=false
```

The public URL must be the actual application URL. Configure the SendGrid Event Webhook to POST to `https://<your-app-host>/api/webhooks/sendgrid` and enable signed event verification. Do not enable scheduled delivery without checking how the worker endpoint is invoked in this deployment.

SendGrid's HTTP 202 means *accepted for processing*, not necessarily delivered. Inspect SendGrid activity and webhook events for delivery confirmation.
