-- Run once as the owner of public.contacts / public.users (or a DBA).
-- Keeps tenant RLS enabled. SECURITY DEFINER owner must have visibility
-- across all tenant rows; verify this before deploying.
CREATE OR REPLACE FUNCTION public.crm_global_email_recipients(
  p_admin_id uuid, p_tag text DEFAULT '', p_source text DEFAULT ''
)
RETURNS TABLE (
  id uuid, name text, email text, source text, company_id uuid,
  recipient_type text, opted_out boolean, suppressed boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
 WITH authorized AS (
  SELECT 1 FROM public.crm_platform_admins a
  JOIN public.users admin_user ON admin_user.id=a.user_id
  WHERE a.user_id=p_admin_id AND admin_user.is_active=true
 ),
 candidates AS (
  SELECT u.id,u.name::text,u.email::text,u.role::text AS source,u.company_id,
   u.role::text AS recipient_type
  FROM public.users u CROSS JOIN authorized
  WHERE u.role IN ('owner','manager','agent') AND u.is_active=true
   AND u.email IS NOT NULL AND btrim(u.email)<>''
   AND p_tag='' AND p_source=''
 ),
 ranked AS (
  SELECT c.*,row_number() OVER (
   PARTITION BY lower(btrim(c.email))
   ORDER BY c.id
  ) AS rn FROM candidates c
 )
 SELECT r.id,r.name,r.email,r.source,r.company_id,r.recipient_type,
  false AS opted_out,
  EXISTS(SELECT 1 FROM public.crm_email_suppressions s
   WHERE s.email=lower(btrim(r.email))) AS suppressed
 FROM ranked r WHERE r.rn=1
 ORDER BY r.name,r.id
 LIMIT 5001;
$function$;
-- SECURITY: restrict execution to the application's DB login.
-- Replace crm_app_role with the actual PostgreSQL login used by DATABASE_URL.
REVOKE ALL ON FUNCTION public.crm_global_email_recipients(uuid,text,text) FROM PUBLIC;
-- GRANT EXECUTE ON FUNCTION public.crm_global_email_recipients(uuid,text,text) TO crm_app_role;
