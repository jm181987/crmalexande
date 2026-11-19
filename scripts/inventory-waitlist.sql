
-- Product waitlist notifications. Apply after scripts/inventory.sql.
CREATE TABLE IF NOT EXISTS public.crm_inventory_waitlist_settings(
 company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
 mode text NOT NULL DEFAULT 'manual' CHECK(mode IN ('manual','automatic')),
 instance_id uuid REFERENCES public.crm_evolution_instances(id) ON DELETE SET NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_inventory_interests ADD COLUMN IF NOT EXISTS whatsapp_opt_in boolean NOT NULL DEFAULT false;
ALTER TABLE public.crm_inventory_interests ADD COLUMN IF NOT EXISTS notified_at timestamptz;
CREATE TABLE IF NOT EXISTS public.crm_inventory_waitlist_dispatches(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
 notification_id uuid NOT NULL REFERENCES public.crm_inventory_notifications(id) ON DELETE CASCADE,
 interest_id uuid NOT NULL REFERENCES public.crm_inventory_interests(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','accepted','unknown','failed','skipped')),
 error text,
 evolution_message_id text,
 sent_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(notification_id,interest_id)
);
CREATE INDEX IF NOT EXISTS crm_inventory_waitlist_dispatches_company_status_idx ON public.crm_inventory_waitlist_dispatches(company_id,status,created_at);
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['crm_inventory_waitlist_settings','crm_inventory_waitlist_dispatches'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('DROP POLICY IF EXISTS inventory_tenant ON public.%I',tab);
  EXECUTE format('CREATE POLICY inventory_tenant ON public.%I FOR ALL USING (company_id = NULLIF(current_setting(''app.company_id'',true),'''')::uuid) WITH CHECK (company_id = NULLIF(current_setting(''app.company_id'',true),'''')::uuid)',tab);
 END LOOP;
END $$;
