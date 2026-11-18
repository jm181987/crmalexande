# BuilderBot integration (review / setup)

1. Run `scripts/builderbot.sql` in the CRM PostgreSQL database. Restrict table access to the backend DB role and verify tenant RLS behavior.
2. In Vercel configure `BUILDERBOT_ENCRYPTION_KEY` as a new random secret of at least 32 characters. Do not use the API key shared in chat; rotate it first.
3. Deploy the branch to a preview environment. In **Integraciones → BuilderBot**, log in as **owner**, set the bot UUID, rotated API key and optional assistant answer UUID. Save the returned webhook token immediately.
4. In BuilderBot, configure webhook URL `https://YOUR_CRM_HOST/api/webhooks/builderbot/BOT_UUID` and custom header `X-Zarco-Webhook-Token: TOKEN_FROM_SAVE`. Keep the header secret. The CRM currently persists incoming events (deduplicated by payload hash) for inspection; mapping them to CRM conversations and messages requires confirming BuilderBot's real event schema. No automatic conversation ingestion is claimed.
5. Test connection, template listing, approved template delivery and individual contact messages using a test contact with recorded WhatsApp opt-in. Confirm correct tenant isolation, owner-only settings, file uploads, and webhook rejection without token.
6. Assistant document uploads accept PDF, TXT, MD, DOCX up to 2.5 MB. API keys are encrypted at rest and not returned by read endpoints. Updating credentials rotates the webhook token; update BuilderBot webhook accordingly.

## Review notes
- This is a first-pass integration, not a production-verified release. No CI, live BuilderBot calls, or Vercel deploy were executed.
- The WhatsApp campaign dispatch worker still uses Evolution API. Provider switching in automated campaigns, real-time conversation synchronization, template variable editor and webhook event mapping are **not implemented** and need a follow-up before claiming full operational parity.
- Webhook authentication uses a custom token in a header; ensure the BuilderBot service sends configured headers.
- Review database grants/RLS and webhook persistence with production tenant policies.
