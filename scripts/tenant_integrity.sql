-- Tenant integrity hardening. Run preflight first; review violations before applying.
-- NOT VALID constraints protect NEW writes while permitting inspection of legacy data.
BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_company_id ON users(company_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_contacts_company_id ON contacts(company_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_pipelines_company_id ON pipelines(company_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_opportunities_company_id ON opportunities(company_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_conversations_company_id ON conversations(company_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_stages_pipeline_id ON stages(pipeline_id,id);
ALTER TABLE contacts ADD CONSTRAINT contacts_owner_tenant_fk FOREIGN KEY(company_id,owner_id) REFERENCES users(company_id,id) NOT VALID;
ALTER TABLE opportunities ADD CONSTRAINT opportunities_contact_tenant_fk FOREIGN KEY(company_id,contact_id) REFERENCES contacts(company_id,id) NOT VALID;
ALTER TABLE opportunities ADD CONSTRAINT opportunities_pipeline_tenant_fk FOREIGN KEY(company_id,pipeline_id) REFERENCES pipelines(company_id,id) NOT VALID;
ALTER TABLE opportunities ADD CONSTRAINT opportunities_owner_tenant_fk FOREIGN KEY(company_id,owner_id) REFERENCES users(company_id,id) NOT VALID;
ALTER TABLE opportunities ADD CONSTRAINT opportunities_stage_pipeline_fk FOREIGN KEY(pipeline_id,stage_id) REFERENCES stages(pipeline_id,id) NOT VALID;
ALTER TABLE conversations ADD CONSTRAINT conversations_contact_tenant_fk FOREIGN KEY(company_id,contact_id) REFERENCES contacts(company_id,id) NOT VALID;
ALTER TABLE conversations ADD CONSTRAINT conversations_assignee_tenant_fk FOREIGN KEY(company_id,assignee_id) REFERENCES users(company_id,id) NOT VALID;
ALTER TABLE tasks ADD CONSTRAINT tasks_contact_tenant_fk FOREIGN KEY(company_id,contact_id) REFERENCES contacts(company_id,id) NOT VALID;
ALTER TABLE tasks ADD CONSTRAINT tasks_owner_tenant_fk FOREIGN KEY(company_id,owner_id) REFERENCES users(company_id,id) NOT VALID;
ALTER TABLE appointments ADD CONSTRAINT appointments_contact_tenant_fk FOREIGN KEY(company_id,contact_id) REFERENCES contacts(company_id,id) NOT VALID;
ALTER TABLE appointments ADD CONSTRAINT appointments_owner_tenant_fk FOREIGN KEY(company_id,owner_id) REFERENCES users(company_id,id) NOT VALID;
COMMIT;
-- Once preflight returns zero violations, VALIDATE each constraint individually.
-- This does not enable RLS: the shared application DB role needs transaction-scoped
-- tenant context before RLS can be safely enabled without breaking existing routes.
