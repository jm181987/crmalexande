-- Execute after backup, before deploying scoped API code.
BEGIN;
ALTER TABLE public.crm_evolution_instances ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS crm_evolution_instances_owner_idx ON public.crm_evolution_instances(company_id,owner_user_id);
CREATE INDEX IF NOT EXISTS crm_inventory_items_creator_idx ON public.crm_inventory_items(company_id,created_by);
-- Existing instances have no recorded creator. NULL remains owner-only until assigned.
-- Existing inventory items with NULL created_by remain owner-only.
COMMIT;
