BEGIN;
CREATE TABLE IF NOT EXISTS crm_automation_rules(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies(id),name text NOT NULL,trigger_event text NOT NULL DEFAULT 'manual',action_type text NOT NULL DEFAULT 'create_task',config jsonb NOT NULL DEFAULT '{}',enabled boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS crm_campaigns(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies(id),name text NOT NULL,channel text NOT NULL DEFAULT 'whatsapp',template_name text,content text NOT NULL DEFAULT '',status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','ready','paused','completed')),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS crm_integrations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies(id),provider text NOT NULL,status text NOT NULL DEFAULT 'disconnected',config jsonb NOT NULL DEFAULT '{}',updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(company_id,provider));
CREATE TABLE IF NOT EXISTS crm_ai_settings(company_id uuid PRIMARY KEY REFERENCES companies(id),mode text NOT NULL DEFAULT 'off' CHECK(mode IN ('off','suggest','auto')),instructions text NOT NULL DEFAULT '',handoff_enabled boolean NOT NULL DEFAULT true,updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS crm_knowledge(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies(id),title text NOT NULL,url text,content text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS crm_review_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies(id),contact_id uuid NOT NULL REFERENCES contacts(id),platform text NOT NULL DEFAULT 'google',review_url text,status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','sent','completed')),created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_crm_automation_company ON crm_automation_rules(company_id);
CREATE INDEX IF NOT EXISTS idx_crm_campaign_company ON crm_campaigns(company_id);
CREATE INDEX IF NOT EXISTS idx_crm_reviews_company ON crm_review_requests(company_id);
COMMIT;
-- Campaign delivery queue: opt-in required; no automatic sending on migration.
ALTER TABLE crm_campaigns ADD COLUMN IF NOT EXISTS filters jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE crm_campaigns ADD COLUMN IF NOT EXISTS instance_name text;
ALTER TABLE crm_campaigns ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;
ALTER TABLE crm_campaigns ADD COLUMN IF NOT EXISTS interval_seconds integer NOT NULL DEFAULT 180 CHECK(interval_seconds BETWEEN 60 AND 86400);
CREATE TABLE IF NOT EXISTS crm_contact_consents (
 company_id uuid NOT NULL REFERENCES companies(id),
 contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
 channel text NOT NULL CHECK(channel IN ('whatsapp','email')),
 opted_in boolean NOT NULL DEFAULT false,
 source text NOT NULL DEFAULT 'manual',
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(company_id,contact_id,channel)
);
CREATE TABLE IF NOT EXISTS crm_campaign_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 campaign_id uuid NOT NULL REFERENCES crm_campaigns(id) ON DELETE CASCADE,
 contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','sent','failed','skipped')),
 due_at timestamptz NOT NULL,
 sent_at timestamptz,
 error_code text,
 external_id text,
 UNIQUE(campaign_id,contact_id)
);
CREATE INDEX IF NOT EXISTS idx_campaign_due ON crm_campaign_deliveries(status,due_at);
CREATE INDEX IF NOT EXISTS idx_campaign_company ON crm_campaign_deliveries(company_id,campaign_id);


-- Idempotent, internal-only follow-up automation (no unsolicited messages).
CREATE TABLE IF NOT EXISTS crm_automation_executions (
 rule_id uuid NOT NULL REFERENCES crm_automation_rules(id) ON DELETE CASCADE,
 contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
 period_date date NOT NULL,
 task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(rule_id,contact_id,period_date)
);
CREATE INDEX IF NOT EXISTS idx_crm_automation_executions_created ON crm_automation_executions(created_at);
-- Durable SendGrid suppression independent of manual opt-in.
CREATE TABLE IF NOT EXISTS crm_email_suppressions (
 company_id uuid NOT NULL REFERENCES companies(id),
 email text NOT NULL,
 reason text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(company_id,email)
);
