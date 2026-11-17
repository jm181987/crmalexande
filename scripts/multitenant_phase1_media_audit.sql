-- ZARKO CRM: read-only review of public media exposure and RLS readiness.
-- Run as DBA. Does not revoke access or change media delivery.
SELECT p.proname,pg_get_userbyid(p.proowner) AS function_owner,p.prosecdef AS security_definer,
 p.proconfig AS function_settings,pg_get_functiondef(p.oid) AS definition,
 has_function_privilege('PUBLIC',p.oid,'EXECUTE') AS executable_by_public
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('crm_public_chat_media','crm_public_inventory_image')
ORDER BY p.proname;
SELECT c.relname AS table_name,c.relrowsecurity AS rls_enabled,c.relforcerowsecurity AS rls_forced,
 pg_get_userbyid(c.relowner) AS owner,
 EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='company_id' AND NOT a.attisdropped) AS has_company_id
FROM pg_class c WHERE c.relnamespace='public'::regnamespace
 AND c.relkind IN ('r','p') AND c.relname IN ('crm_chat_media','crm_inventory_images','conversations','messages')
ORDER BY c.relname;
SELECT tablename,policyname,roles,cmd,permissive,qual,with_check
FROM pg_policies WHERE schemaname='public'
 AND tablename IN ('crm_chat_media','crm_inventory_images','conversations','messages')
ORDER BY tablename,policyname;
SELECT rolname,rolsuper,rolbypassrls,rolcanlogin FROM pg_roles
WHERE rolname='knj_crm_alexandre_crm_usr';
