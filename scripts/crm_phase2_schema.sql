-- Alexandre CRM: phase 2 schema, run manually as postgres after backup.
-- Additive migration. Does not enable RLS or alter existing data.
BEGIN;
CREATE TABLE IF NOT EXISTS public.crm_smart_lists(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES public.companies(id),
 name text NOT NULL,
 filters jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_by uuid REFERENCES public.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,name)
);
CREATE TABLE IF NOT EXISTS public.crm_contact_files(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES public.companies(id),
 contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
 uploaded_by uuid REFERENCES public.users(id),
 filename text NOT NULL,
 mime_type text NOT NULL,
 size_bytes bigint NOT NULL CHECK(size_bytes BETWEEN 0 AND 10485760),
 storage_key text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,storage_key)
);
CREATE TABLE IF NOT EXISTS public.crm_automation_jobs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES public.companies(id),
 rule_id uuid REFERENCES public.crm_automation_rules(id) ON DELETE SET NULL,
 contact_id uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
 conversation_id uuid REFERENCES public.conversations(id) ON DELETE CASCADE,
 action_type text NOT NULL,
 payload jsonb NOT NULL DEFAULT '{}'::jsonb,
 run_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','failed','cancelled')),
 attempts integer NOT NULL DEFAULT 0,
 last_error text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_automation_jobs_due ON public.crm_automation_jobs(status,run_at);
CREATE INDEX IF NOT EXISTS idx_crm_contact_files_contact ON public.crm_contact_files(company_id,contact_id);
CREATE INDEX IF NOT EXISTS idx_crm_smart_lists_company ON public.crm_smart_lists(company_id);
GRANT SELECT,INSERT,UPDATE,DELETE ON public.crm_smart_lists,public.crm_contact_files,public.crm_automation_jobs TO knj_crm_alexandre_crm_usr;
COMMIT;
-- Before enabling RLS again, create tenant policies for these three new tables.
