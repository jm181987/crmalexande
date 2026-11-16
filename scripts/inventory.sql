-- ZARKO multisector inventory. Run in PostgreSQL before enabling the inventory screen.
CREATE TABLE IF NOT EXISTS crm_inventory_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 kind text NOT NULL DEFAULT 'product' CHECK(kind IN ('product','vehicle','property','service')),
 name text NOT NULL,
 sku text,
 description text NOT NULL DEFAULT '',
 price numeric(14,2) NOT NULL DEFAULT 0 CHECK(price>=0),
 currency varchar(3) NOT NULL DEFAULT 'BRL',
 quantity numeric(14,2) NOT NULL DEFAULT 0 CHECK(quantity>=0),
 status text NOT NULL DEFAULT 'available' CHECK(status IN ('available','reserved','sold','inactive')),
 image_url text,
 attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_by uuid REFERENCES users(id) ON DELETE SET NULL,
 updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS crm_inventory_sku_company_unique ON crm_inventory_items(company_id,lower(sku)) WHERE sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_inventory_company_kind_idx ON crm_inventory_items(company_id,kind,status);
CREATE TABLE IF NOT EXISTS crm_inventory_movements(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 item_id uuid NOT NULL,
 actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
 previous_quantity numeric(14,2) NOT NULL,
 new_quantity numeric(14,2) NOT NULL,
 reason text NOT NULL DEFAULT 'manual',
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,item_id) REFERENCES crm_inventory_items(company_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS crm_inventory_movements_item_idx ON crm_inventory_movements(company_id,item_id,created_at DESC);
CREATE TABLE IF NOT EXISTS crm_inventory_interests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 item_id uuid NOT NULL,
 contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
 notify_on_restock boolean NOT NULL DEFAULT true,
 notify_on_price_change boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,item_id,contact_id),
 FOREIGN KEY(company_id,item_id) REFERENCES crm_inventory_items(company_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS crm_inventory_notifications(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 item_id uuid NOT NULL,
 event_type text NOT NULL CHECK(event_type IN ('restock','price_change')),
 old_value text,
 new_value text,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processed','cancelled')),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,item_id) REFERENCES crm_inventory_items(company_id,id) ON DELETE CASCADE
);
-- Tenant isolation enforced by application company_id predicates and PostgreSQL RLS.
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['crm_inventory_items','crm_inventory_movements','crm_inventory_interests','crm_inventory_notifications'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('DROP POLICY IF EXISTS inventory_tenant ON public.%I',tab);
  EXECUTE format('CREATE POLICY inventory_tenant ON public.%I FOR ALL USING (company_id = NULLIF(current_setting(''app.company_id'',true),'''')::uuid) WITH CHECK (company_id = NULLIF(current_setting(''app.company_id'',true),'''')::uuid)',tab);
 END LOOP;
END $$;
-- For installations with TENANT_DB_CONTEXT=false, a dedicated non-bypass role
-- requires the tenant context to be enabled before these tables can be queried.

CREATE TABLE IF NOT EXISTS crm_inventory_images(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
 mime text NOT NULL CHECK(mime IN ('image/jpeg','image/png','image/webp')),
 content bytea NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE crm_inventory_images ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inventory_tenant ON crm_inventory_images;
CREATE POLICY inventory_tenant ON crm_inventory_images FOR ALL
 USING (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid)
 WITH CHECK (company_id = NULLIF(current_setting('app.company_id',true),'')::uuid);
-- Images are accessed through unguessable UUIDs to support Evolution API media retrieval.
-- The SECURITY DEFINER function exposes only image bytes and MIME for known IDs.
CREATE OR REPLACE FUNCTION public.crm_public_inventory_image(p_id uuid)
RETURNS TABLE(mime text, content bytea)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$ SELECT i.mime,i.content FROM public.crm_inventory_images i WHERE i.id=p_id LIMIT 1 $$;
REVOKE ALL ON FUNCTION public.crm_public_inventory_image(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_public_inventory_image(uuid) TO PUBLIC;
