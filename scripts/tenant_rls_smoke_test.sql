-- Read-only RLS smoke test. Run as postgres AFTER activating RLS.
-- Replace both UUID placeholders with real, distinct company IDs.
-- Never run with live application traffic in the same SQL transaction.
BEGIN;
SET LOCAL ROLE knj_crm_alexandre_crm_usr;
SELECT current_user AS role_under_test,
       (SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user) AS bypasses_rls;
-- Without tenant context, protected rows must be invisible.
SELECT count(*) AS contacts_without_context FROM public.contacts;
SELECT count(*) AS users_without_context FROM public.users;
SELECT count(*) AS instances_without_context FROM public.crm_evolution_instances;
-- For tenant A, set transaction-local context using the actual UUID:
-- SELECT set_config('app.company_id','<COMPANY_A_UUID>',true);
-- SELECT count(*) FROM public.contacts WHERE company_id <> '<COMPANY_A_UUID>'::uuid;
-- SELECT count(*) FROM public.users WHERE company_id <> '<COMPANY_A_UUID>'::uuid;
-- SELECT count(*) FROM public.crm_evolution_instances WHERE company_id <> '<COMPANY_A_UUID>'::uuid;
-- All three cross-company counts must be zero.
-- Repeat in a new transaction with tenant B.
ROLLBACK;
