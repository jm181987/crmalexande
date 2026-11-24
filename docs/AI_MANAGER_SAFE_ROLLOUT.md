# AI Manager — non-invasive phase 1

The initial implementation is **only a standalone, pure analysis module**: `server/ai-manager-observer.js` with `node --test server/ai-manager-observer.test.js`.

It is **not imported by the production entrypoint**, **not registered as a webhook**, **not connected to Evolution**, **not a background worker**, and **cannot write to the database or send WhatsApp messages**. The rule-based signals are provisional diagnostics, **not** a deployed language model or a production-grade lead classifier.

Existing BuilderBot and Evolution integrations remain unchanged by this phase. There is no new migration, env requirement, runtime process or automatic Kanban mutation.

## Safety gates before any live observer
1. Obtain staging DB schema and exact conversation ingestion paths; confirm inbound and outbound messages are stored with company and instance IDs.
2. Establish a production backup and tested restore; record baseline health checks for BuilderBot, Evolution and Coolify.
3. Add independent read-only worker and credentials, strict company scoping, event deduplication and rate limits.
4. Prove no writes to contacts/opportunities, no outbound WhatsApp requests, no webhook modification, and no increased latency on existing ingestion.
5. Roll out with disabled-by-default feature flag and canary on one company. Keep an immediate off switch.
6. Only after verified observer accuracy, propose separately reviewed CRM write tools.

No deployment or production safety guarantee is implied by this commit.
