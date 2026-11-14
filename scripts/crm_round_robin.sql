-- Run once as postgres after backup. Round Robin is OFF by default.
BEGIN;
CREATE TABLE IF NOT EXISTS public.crm_round_robin_settings(
 company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
 enabled boolean NOT NULL DEFAULT false,
 last_assignee_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT,INSERT,UPDATE,DELETE ON public.crm_round_robin_settings TO knj_crm_alexandre_crm_usr;
CREATE OR REPLACE FUNCTION public.crm_assign_round_robin(p_company_id uuid,p_conversation_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_enabled boolean;v_last uuid;v_next uuid;v_current uuid;
BEGIN
 INSERT INTO public.crm_round_robin_settings(company_id) VALUES(p_company_id) ON CONFLICT DO NOTHING;
 SELECT enabled,last_assignee_id INTO v_enabled,v_last FROM public.crm_round_robin_settings WHERE company_id=p_company_id FOR UPDATE;
 IF NOT v_enabled THEN RETURN NULL; END IF;
 SELECT assignee_id INTO v_current FROM public.conversations WHERE id=p_conversation_id AND company_id=p_company_id FOR UPDATE;
 IF NOT FOUND OR v_current IS NOT NULL THEN RETURN v_current; END IF;
 SELECT id INTO v_next FROM public.users
 WHERE company_id=p_company_id AND role='agent' AND is_active=true AND (v_last IS NULL OR id>v_last)
 ORDER BY id LIMIT 1;
 IF v_next IS NULL THEN
  SELECT id INTO v_next FROM public.users WHERE company_id=p_company_id AND role='agent' AND is_active=true ORDER BY id LIMIT 1;
 END IF;
 IF v_next IS NULL THEN RETURN NULL; END IF;
 UPDATE public.conversations SET assignee_id=v_next,updated_at=now() WHERE id=p_conversation_id AND company_id=p_company_id AND assignee_id IS NULL;
 UPDATE public.crm_round_robin_settings SET last_assignee_id=v_next,updated_at=now() WHERE company_id=p_company_id;
 RETURN v_next;
END;$$;
COMMIT;
-- For future RLS activation, add tenant policy for crm_round_robin_settings.
