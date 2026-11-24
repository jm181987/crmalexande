# ZARKO CRM — Native AI + Evolution API implementation plan

Status: DESIGN / NOT DEPLOYED. Target: Coolify, PostgreSQL, America/Montevideo. Languages: es, pt, en.

## Repository audit
- `server/evolution-instances.js`: tenant-linked Evolution instances, webhook secret, `/api/webhooks/evolution/:secret`, MESSAGES_UPSERT and CONNECTION_UPDATE.
- `server/index.js`: contacts, opportunities, stages, conversations, automation endpoints.
- `server/automation-scheduler.js` and `server/followup-automation.js`: existing scheduler/follow-up; reuse safely.
- `server/builderbot.js`: existing BuilderBot integration; preserve until migration completed.
- `src/main.jsx`: existing Kanban, contacts and conversation UI.
These are inspected integration points, not a guarantee that no other AI code exists.

## Ten capabilities
1. Native AI: per-company AI agent with instructions, tools, language detection, safe responses and model adapter.
2. Message grouping: persist incoming events and debounce per conversation (e.g. configurable 8-15 seconds); avoid duplicate replies and cross-instance collisions.
3. Multimedia: safely fetch supported media; transcribe audio; analyze images; extract PDF/document text; respect file limits and MIME verification.
4. Knowledge: company-scoped documents, ingestion, retrieval with citations and permission checks; never cross tenant boundaries.
5. Lead qualification: company-configurable questions, structured answers, lead score and contact custom fields.
6. Contextual follow-up: queue scheduled jobs, cancellation on customer reply, opt-out and quiet hours, retries and delivery audit.
7. Kanban: rule-based tool actions with allowed stage transitions and audit records; require confirmation for consequential changes.
8. Human handoff: conversation ownership, bot pause, agent notification, manual resume, no double replies.
9. Sales: record verified deal outcome in opportunities; never infer payment from an unverified chat claim.
10. Daily summary: scheduled per-company digest of conversations, leads, stage movements and confirmed sales, sent to configured opt-in WhatsApp recipients.

## Proposed data model (migration needed)
- `crm_ai_agents`: company_id, enabled, model, system_prompt, language_policy, debounce_seconds, handoff_policy, updated_at.
- `crm_ai_knowledge_documents` and `crm_ai_knowledge_chunks`: company_id, source, content, ingestion_status, embedding metadata.
- `crm_ai_conversation_state`: company_id, conversation_id, instance_id, mode (ai/human/paused), assigned_user_id, last_inbound_at, language, qualification JSON.
- `crm_ai_jobs`: company_id, conversation_id, kind, due_at, status, attempts, idempotency_key UNIQUE, last_error.
- `crm_ai_actions`: company_id, conversation_id, action, payload, approval_state, actor, created_at.
- `crm_ai_daily_digests`: company_id, local_date, recipient, status, sent_at, UNIQUE(company_id,local_date,recipient).
Use RLS and existing company_id scoping. Validate exact existing table names/columns before migration.

## Runtime pipeline
1. Verify webhook secret and resolve instance/company. Acknowledge quickly; store event idempotently.
2. Ignore outbound, group, duplicate and unsupported events; update CRM conversation and contact through existing ingestion path.
3. Enqueue one debounce job per conversation; worker locks by company+instance+conversation.
4. Check tenant configuration, consent, human takeover, rate limits, opt-outs, quiet hours and instance connection.
5. Resolve language, retrieve recent context and tenant knowledge; run AI model with schema-validated tool calls.
6. Validate tools server-side (never let model execute SQL or unrestricted HTTP); record audit, send via Evolution API.
7. Record provider message ID and delivery status; retry transient failures with backoff and dead-letter handling.

## Implementation phases and acceptance criteria
Phase 0: baseline tests, schema inspection, feature flags, observability, staging on Coolify.
Phase 1: text-only AI, webhook deduplication, debounce, company isolation, multilingual prompts, manual takeover. Test concurrent messages and no duplicate sends.
Phase 2: audio/image/document ingestion and tenant knowledge. Test unsupported formats, oversized files and access isolation.
Phase 3: qualification, contact enrichment, guarded Kanban transitions and human routing. Test permissions, consent and audit.
Phase 4: contextual follow-up, quiet hours in America/Montevideo, cancellation, retries and daily summaries. Test timezone, opt-out, restart recovery and duplicate digest prevention.
Phase 5: load testing, security review, production pilot with one tenant/instance, rollout and rollback.

## Configuration (proposed; not yet implemented)
- CRM_NATIVE_AI_ENABLED=false
- CRM_NATIVE_AI_MODEL_PROVIDER / CRM_NATIVE_AI_MODEL / CRM_NATIVE_AI_API_KEY (secret)
- CRM_NATIVE_AI_WORKER_ENABLED=false
- CRM_NATIVE_AI_DEFAULT_DEBOUNCE_SECONDS=10
- TZ=America/Montevideo
Reuse existing EVOLUTION_API_URL, EVOLUTION_API_KEY and instance-specific credentials. Do not expose secrets to the browser.

## Non-negotiable safeguards
- No automatic messages to opted-out recipients; per-company rate limits.
- Only one automated responder per WhatsApp instance (disable competing BuilderBot auto-replies before enabling native AI).
- Human handoff overrides bot, including queued jobs.
- Tool allowlist, schema validation, least privilege, prompt injection defense and audit.
- No assumption that provider HTTP success means message delivered.
- Feature flags default OFF; migrations additive and reversible; staged rollout.
- No production enablement until build, DB migration and Coolify runtime checks pass.
