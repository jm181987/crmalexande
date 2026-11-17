-- Run once before deploying platform company tools.
CREATE TABLE IF NOT EXISTS public.crm_platform_admins (
 user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.crm_company_tools (
 company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
 tool_key text NOT NULL CHECK (tool_key IN ('inventory','conversations','opportunities','contacts','calendar','tasks','ai','automation','campaigns','reviews','reports','evolution')),
 enabled boolean NOT NULL DEFAULT true,
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
 PRIMARY KEY(company_id,tool_key)
);
-- Bind global administration to the verified active account, not to the company owner role.
INSERT INTO public.crm_platform_admins(user_id)
SELECT id FROM public.users
WHERE id='fecf7321-5899-462b-8627-ebac999e013b'
 AND lower(email)='jorgitom18@gmail.com' AND is_active=true
ON CONFLICT DO NOTHING;
-- Audit:
SELECT u.id,u.email FROM public.crm_platform_admins a JOIN public.users u ON u.id=a.user_id;
