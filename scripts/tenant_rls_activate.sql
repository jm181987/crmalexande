-- RUN AS postgres ONLY during a coordinated maintenance window.
-- Prerequisites: deploy server code with TENANT_RLS_ENABLED support; confirm
-- DATABASE_URL uses knj_crm_alexandre_crm_usr and set TENANT_DB_CONTEXT=true
-- and TENANT_RLS_ENABLED=true in the same production release.
-- BACK UP FIRST. This script enables RLS; do not run without readiness.
BEGIN;
CREATE OR REPLACE FUNCTION public.crm_auth_user_by_email(p_email text)
RETURNS TABLE(id uuid,company_id uuid,name text,email text,role text,password_hash text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $fn$ SELECT u.id,u.company_id,u.name,u.email,u.role,u.password_hash FROM public.users u
 WHERE lower(u.email)=lower(p_email) AND u.is_active=true LIMIT 1 $fn$;
CREATE OR REPLACE FUNCTION public.crm_auth_user_by_id(p_id uuid)
RETURNS TABLE(id uuid,company_id uuid,name text,email text,role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $fn$ SELECT u.id,u.company_id,u.name,u.email,u.role FROM public.users u
 WHERE u.id=p_id AND u.is_active=true LIMIT 1 $fn$;
CREATE OR REPLACE FUNCTION public.crm_webhook_instance_by_hash(p_hash text)
RETURNS TABLE(id uuid,company_id uuid,name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $fn$ SELECT i.id,i.company_id,i.name FROM public.crm_evolution_instances i
 WHERE i.webhook_secret_hash=p_hash LIMIT 1 $fn$;
REVOKE ALL ON FUNCTION public.crm_auth_user_by_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crm_auth_user_by_id(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crm_webhook_instance_by_hash(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_auth_user_by_email(text) TO knj_crm_alexandre_crm_usr;
GRANT EXECUTE ON FUNCTION public.crm_auth_user_by_id(uuid) TO knj_crm_alexandre_crm_usr;
GRANT EXECUTE ON FUNCTION public.crm_webhook_instance_by_hash(text) TO knj_crm_alexandre_crm_usr;
DROP POLICY IF EXISTS tenant_isolation ON public.companies;
CREATE POLICY tenant_isolation ON public.companies FOR ALL TO knj_crm_alexandre_crm_usr
 USING (id = NULLIF(current_setting('app.company_id',true),'')::uuid)
 WITH CHECK (id = NULLIF(current_setting('app.company_id',true),'')::uuid);
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.users;
CREATE POLICY tenant_isolation ON public.users FOR ALL TO knj_crm_alexandre_crm_usr
 USING (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid)
 WITH CHECK (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid);
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.contacts;
CREATE POLICY tenant_isolation ON public.contacts FOR ALL TO knj_crm_alexandre_crm_usr
 USING (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid)
 WITH CHECK (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid);
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.pipelines;
CREATE POLICY tenant_isolation ON public.pipelines FOR ALL TO knj_crm_alexandre_crm_usr
 USING (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid)
 WITH CHECK (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid);
ALTER TABLE public.pipelines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.opportunities;
CREATE POLICY tenant_isolation ON public.opportunities FOR ALL TO knj_crm_alexandre_crm_usr
 USING (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid)
 WITH CHECK (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid);
ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.conversations;
CREATE POLICY tenant_isolation ON public.conversations FOR ALL TO knj_crm_alexandre_crm_usr
 USING (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid)
 WITH CHECK (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid);
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.tasks;
CREATE POLICY tenant_isolation ON public.tasks FOR ALL TO knj_crm_alexandre_crm_usr
 USING (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid)
 WITH CHECK (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid);
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.appointments;
CREATE POLICY tenant_isolation ON public.appointments FOR ALL TO knj_crm_alexandre_crm_usr
 USING (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid)
 WITH CHECK (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid);
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.audit_logs;
CREATE POLICY tenant_isolation ON public.audit_logs FOR ALL TO knj_crm_alexandre_crm_usr
 USING (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid)
 WITH CHECK (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid);
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.crm_ai_settings;
CREATE POLICY tenant_isolation ON public.crm_ai_settings FOR ALL TO knj_crm_alexandre_crm_usr
 USING (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid)
 WITH CHECK (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid);
ALTER TABLE public.crm_ai_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.crm_automation_rules;
CREATE POLICY tenant_isolation ON public.crm_automation_rules FOR ALL TO knj_crm_alexandre_crm_usr
 USING (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid)
 WITH CHECK (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid);
ALTER TABLE public.crm_automation_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.crm_campaigns;
CREATE POLICY tenant_isolation ON public.crm_campaigns FOR ALL TO knj_crm_alexandre_crm_usr
 USING (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid)
 WITH CHECK (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid);
ALTER TABLE public.crm_campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.crm_evolution_instances;
CREATE POLICY tenant_isolation ON public.crm_evolution_instances FOR ALL TO knj_crm_alexandre_crm_usr
 USING (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid)
 WITH CHECK (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid);
ALTER TABLE public.crm_evolution_instances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.crm_integrations;
CREATE POLICY tenant_isolation ON public.crm_integrations FOR ALL TO knj_crm_alexandre_crm_usr
 USING (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid)
 WITH CHECK (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid);
ALTER TABLE public.crm_integrations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.crm_knowledge;
CREATE POLICY tenant_isolation ON public.crm_knowledge FOR ALL TO knj_crm_alexandre_crm_usr
 USING (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid)
 WITH CHECK (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid);
ALTER TABLE public.crm_knowledge ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.crm_review_requests;
CREATE POLICY tenant_isolation ON public.crm_review_requests FOR ALL TO knj_crm_alexandre_crm_usr
 USING (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid)
 WITH CHECK (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid);
ALTER TABLE public.crm_review_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_stage_isolation ON public.stages;
CREATE POLICY tenant_stage_isolation ON public.stages FOR ALL TO knj_crm_alexandre_crm_usr
 USING (EXISTS(SELECT 1 FROM public.pipelines p WHERE p.id=stages.pipeline_id AND p.company_id=NULLIF(current_setting('app.company_id',true),'')::uuid))
 WITH CHECK (EXISTS(SELECT 1 FROM public.pipelines p WHERE p.id=stages.pipeline_id AND p.company_id=NULLIF(current_setting('app.company_id',true),'')::uuid));
ALTER TABLE public.stages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_message_isolation ON public.messages;
CREATE POLICY tenant_message_isolation ON public.messages FOR ALL TO knj_crm_alexandre_crm_usr
 USING (EXISTS(SELECT 1 FROM public.conversations c WHERE c.id=messages.conversation_id AND c.company_id=NULLIF(current_setting('app.company_id',true),'')::uuid))
 WITH CHECK (EXISTS(SELECT 1 FROM public.conversations c WHERE c.id=messages.conversation_id AND c.company_id=NULLIF(current_setting('app.company_id',true),'')::uuid));
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
COMMIT;
