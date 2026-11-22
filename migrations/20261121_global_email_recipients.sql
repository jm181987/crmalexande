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
  SELECT c.id,c.name::text,c.email::text,c.source::text,c.company_id,
   'client'::text AS recipient_type
  FROM public.contacts c CROSS JOIN authorized
  WHERE c.email IS NOT NULL AND btrim(c.email)<>''
   AND (p_tag='' OR p_tag=ANY(coalesce(c.tags,ARRAY[]::text[])))
   AND (p_source='' OR c.source=p_source)
  UNION ALL
  SELECT u.id,u.name::text,u.email::text,u.role::text,u.company_id,
   u.role::text
  FROM public.users u CROSS JOIN authorized
  WHERE u.role IN ('owner','manager','agent') AND u.is_active=true
   AND u.email IS NOT NULL AND btrim(u.email)<>''
   AND p_tag='' AND p_source=''
 ),
 ranked AS (
  SELECT c.*,row_number() OVER (
   PARTITION BY lower(btrim(c.email))
   ORDER BY CASE WHEN c.recipient_type='client' THEN 0 ELSE 1 END,c.id
  ) AS rn FROM candidates c
 )
 SELECT r.id,r.name,r.email,r.source,r.company_id,r.recipient_type,
  EXISTS(SELECT 1 FROM public.crm_contact_consents co
   JOIN public.contacts c ON c.id=co.contact_id AND c.company_id=co.company_id
   WHERE lower(btrim(c.email))=lower(btrim(r.email))
   AND co.channel='email' AND co.opted_in=false) AS opted_out,
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
