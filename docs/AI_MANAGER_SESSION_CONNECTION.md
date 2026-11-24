# AI manager: read-only observation and dedicated WhatsApp control session

## Two different connections
**Existing customer session**: BuilderBot + Evolution already writes inbound and outbound conversation messages into ZARKO CRM. This is the source of commercial analysis. Do not alter the existing instance, webhook, BuilderBot token or response flow.

**Second dedicated WhatsApp number**: optional private control channel for asking the manager for summaries and receiving notifications. It cannot independently read conversations belonging to the existing number. Link it as a separate Evolution instance, with a distinct instance name and phone number, only after confirming whether the CRM already associates the first instance with the same tenant. Do not attach another automatic responder.

## Current implementation
`server/ai-manager-readonly.js` exports `observeStoredConversation({companyId,conversationId,read})`. It reads the existing `conversations`, `contacts` and `messages` tables with company_id and conversation_id filters and calls the isolated observer. It has no DB writes, sends no WhatsApp messages, and is not imported by the production app. Run `node --test server/ai-manager-observer.test.js server/ai-manager-readonly.test.js`.

This is an adapter, not a running AI worker. Before a worker can be enabled, verify real message completeness (both directions), ensure the company is correctly resolved and add read-only DB credentials, polling cursor, throttling, deduplication and a safe deployment plan.

## Future connection procedure (not executed)
1. Back up PostgreSQL and record working BuilderBot/Evolution instance IDs and webhook configuration.
2. Verify `GET /api/evolution/config-check` and the current instances in CRM admin.
3. Provision a **new** Evolution instance, e.g. `zarko-manager-control`, assigned to the correct company. Never reuse the existing instance name.
4. Connect the dedicated number by QR and verify only its own instance status/webhook.
5. Use the second instance only for authorized admin commands and reports. Require allowlisted admin phone numbers and command authentication.
6. The AI manager reads CRM's existing stored customer conversations, not messages from the second number.
7. Keep analysis read-only until accuracy and tenant-isolation tests pass. Separate approvals required for Kanban writes.

## Limitations
No runtime deployment or DB query has been performed; repository inspection does not establish that all BuilderBot outbound replies are persisted. Some BuilderBot event formats may omit direction or message body. Verify actual rows before enabling automated decisions.
