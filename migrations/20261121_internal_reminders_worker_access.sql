-- The internal reminder worker uses the same database role as the application,
-- outside request tenant context. An enabled RLS table without a worker policy
-- blocks both queueing and dispatch. Tenant isolation is enforced in the
-- application SQL by company_id; no HTTP endpoint exposes this table.
ALTER TABLE public.crm_internal_appointment_reminders DISABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_internal_appointment_reminders FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.crm_internal_appointment_reminders_id_seq FROM PUBLIC;
-- The existing application DB owner retains access. If your DATABASE_URL role
-- is not the owner, grant SELECT, INSERT, UPDATE on this table and USAGE on
-- its sequence explicitly to that role (do not grant to PUBLIC).
