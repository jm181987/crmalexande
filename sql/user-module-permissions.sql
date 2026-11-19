-- ZARKO CRM: ejecutar en PostgreSQL antes del despliegue
BEGIN;
CREATE TABLE IF NOT EXISTS public.crm_user_module_permissions (
 company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 module_key text NOT NULL CHECK (module_key IN ('dashboard','inventory','conversations','opportunities','contacts','calendar','tasks','ai','automation','campaigns','reviews','reports','settings')),
 can_view boolean NOT NULL DEFAULT true,
 can_create boolean NOT NULL DEFAULT true,
 can_edit boolean NOT NULL DEFAULT true,
 can_delete boolean NOT NULL DEFAULT true,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (company_id,user_id,module_key),
 CONSTRAINT crm_user_module_permissions_consistency CHECK (can_view OR NOT (can_create OR can_edit OR can_delete))
);
CREATE INDEX IF NOT EXISTS crm_user_module_permissions_user_idx ON public.crm_user_module_permissions(user_id);
CREATE OR REPLACE FUNCTION public.crm_check_user_module_permission_company()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.users WHERE id=NEW.user_id AND company_id=NEW.company_id) THEN
  RAISE EXCEPTION 'El usuario no pertenece a la empresa';
 END IF;
 NEW.updated_at=now();
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS crm_user_module_permissions_company_check ON public.crm_user_module_permissions;
CREATE TRIGGER crm_user_module_permissions_company_check BEFORE INSERT OR UPDATE
ON public.crm_user_module_permissions FOR EACH ROW EXECUTE FUNCTION public.crm_check_user_module_permission_company();
COMMIT;
SELECT to_regclass('public.crm_user_module_permissions') AS tabla_creada;
