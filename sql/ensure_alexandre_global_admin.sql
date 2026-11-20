-- Execute once in the production PostgreSQL database as a privileged operator.
-- This is an explicit, auditable bootstrap of an existing active account.
BEGIN;
DO $$
DECLARE target_id uuid;
BEGIN
 SELECT id INTO target_id FROM public.users
 WHERE lower(trim(email))='admin@alexandre.com' AND is_active=true;
 IF target_id IS NULL THEN
  RAISE EXCEPTION 'Active account admin@alexandre.com not found; no changes made';
 END IF;
 INSERT INTO public.crm_platform_admins(user_id)
 VALUES(target_id) ON CONFLICT (user_id) DO NOTHING;
END $$;
COMMIT;
-- Verify:
-- SELECT u.email,u.is_active,(a.user_id IS NOT NULL) AS platform_admin
-- FROM public.users u LEFT JOIN public.crm_platform_admins a ON a.user_id=u.id
-- WHERE lower(trim(u.email)) IN ('admin@alexandre.com','jorgitom18@gmail.com');
