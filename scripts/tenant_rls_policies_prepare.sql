-- PREPARE ONLY: creates policies, DOES NOT ENABLE RLS.
-- Requires a dedicated non-owner, non-BYPASSRLS application role before activation.
-- Current login and webhook lookup use unscoped queries: users/companies are
-- deliberately excluded until an explicit auth lookup strategy is implemented.
BEGIN;
DROP POLICY IF EXISTS tenant_isolation ON public.contacts;
CREATE POLICY tenant_isolation ON public.contacts
 FOR ALL USING (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid)
 WITH CHECK (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid);
DROP POLICY IF EXISTS tenant_isolation ON public.pipelines;
CREATE POLICY tenant_isolation ON public.pipelines
 FOR ALL USING (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid)
 WITH CHECK (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid);
DROP POLICY IF EXISTS tenant_isolation ON public.opportunities;
CREATE POLICY tenant_isolation ON public.opportunities
 FOR ALL USING (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid)
 WITH CHECK (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid);
DROP POLICY IF EXISTS tenant_isolation ON public.conversations;
CREATE POLICY tenant_isolation ON public.conversations
 FOR ALL USING (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid)
 WITH CHECK (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid);
DROP POLICY IF EXISTS tenant_isolation ON public.tasks;
CREATE POLICY tenant_isolation ON public.tasks
 FOR ALL USING (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid)
 WITH CHECK (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid);
DROP POLICY IF EXISTS tenant_isolation ON public.appointments;
CREATE POLICY tenant_isolation ON public.appointments
 FOR ALL USING (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid)
 WITH CHECK (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid);
DROP POLICY IF EXISTS tenant_isolation ON public.audit_logs;
CREATE POLICY tenant_isolation ON public.audit_logs
 FOR ALL USING (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid)
 WITH CHECK (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid);
DROP POLICY IF EXISTS tenant_isolation ON public.crm_ai_settings;
CREATE POLICY tenant_isolation ON public.crm_ai_settings
 FOR ALL USING (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid)
 WITH CHECK (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid);
DROP POLICY IF EXISTS tenant_isolation ON public.crm_automation_rules;
CREATE POLICY tenant_isolation ON public.crm_automation_rules
 FOR ALL USING (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid)
 WITH CHECK (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid);
DROP POLICY IF EXISTS tenant_isolation ON public.crm_campaigns;
CREATE POLICY tenant_isolation ON public.crm_campaigns
 FOR ALL USING (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid)
 WITH CHECK (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid);
DROP POLICY IF EXISTS tenant_isolation ON public.crm_evolution_instances;
CREATE POLICY tenant_isolation ON public.crm_evolution_instances
 FOR ALL USING (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid)
 WITH CHECK (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid);
DROP POLICY IF EXISTS tenant_isolation ON public.crm_integrations;
CREATE POLICY tenant_isolation ON public.crm_integrations
 FOR ALL USING (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid)
 WITH CHECK (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid);
DROP POLICY IF EXISTS tenant_isolation ON public.crm_knowledge;
CREATE POLICY tenant_isolation ON public.crm_knowledge
 FOR ALL USING (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid)
 WITH CHECK (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid);
DROP POLICY IF EXISTS tenant_isolation ON public.crm_review_requests;
CREATE POLICY tenant_isolation ON public.crm_review_requests
 FOR ALL USING (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid)
 WITH CHECK (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid);
DROP POLICY IF EXISTS tenant_stage_isolation ON public.stages;
CREATE POLICY tenant_stage_isolation ON public.stages FOR ALL
 USING (EXISTS(SELECT 1 FROM public.pipelines p WHERE p.id=stages.pipeline_id AND p.company_id=NULLIF(current_setting('app.company_id',true),'')::uuid))
 WITH CHECK (EXISTS(SELECT 1 FROM public.pipelines p WHERE p.id=stages.pipeline_id AND p.company_id=NULLIF(current_setting('app.company_id',true),'')::uuid));
DROP POLICY IF EXISTS tenant_message_isolation ON public.messages;
CREATE POLICY tenant_message_isolation ON public.messages FOR ALL
 USING (EXISTS(SELECT 1 FROM public.conversations c WHERE c.id=messages.conversation_id AND c.company_id=NULLIF(current_setting('app.company_id',true),'')::uuid))
 WITH CHECK (EXISTS(SELECT 1 FROM public.conversations c WHERE c.id=messages.conversation_id AND c.company_id=NULLIF(current_setting('app.company_id',true),'')::uuid));
COMMIT;
-- DO NOT ENABLE RLS OR FORCE RLS UNTIL ALL AUTH, WEBHOOK AND ROLE TESTS PASS.
