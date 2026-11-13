BEGIN;
CREATE TABLE IF NOT EXISTS crm_evolution_instances(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id),
 name text NOT NULL UNIQUE,
 label text NOT NULL,
 webhook_secret_hash text NOT NULL,
 status text NOT NULL DEFAULT 'pending',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_evolution_company ON crm_evolution_instances(company_id);
COMMIT;