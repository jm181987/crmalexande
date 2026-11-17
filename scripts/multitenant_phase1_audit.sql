-- ZARKO CRM · Fase 1: auditoría de aislamiento (solo lectura).
-- Ejecutar con rol de auditor/DBA. No modifica datos ni activa RLS.
-- No interpretar "RLS habilitado" como aislamiento suficiente:
-- comprobar también propietario de tablas, BYPASSRLS y políticas.
SELECT current_database() AS database_name,current_user AS audit_role,now() AS audited_at;
SELECT rolname,rolsuper,rolbypassrls,rolcanlogin
FROM pg_roles WHERE rolname=current_user OR rolname='knj_crm_alexandre_crm_usr'
ORDER BY rolname;
-- Inventario de tablas de aplicación y cobertura de company_id.
SELECT t.table_name,
 EXISTS(SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name=t.table_name AND c.column_name='company_id') AS has_company_id,
 COALESCE(cls.relrowsecurity,false) AS rls_enabled,
 COALESCE(cls.relforcerowsecurity,false) AS rls_forced,
 pg_get_userbyid(cls.relowner) AS table_owner,
 (SELECT count(*) FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=t.table_name) AS policy_count
FROM information_schema.tables t
LEFT JOIN pg_class cls ON cls.relname=t.table_name AND cls.relnamespace='public'::regnamespace
WHERE t.table_schema='public' AND t.table_type='BASE TABLE'
 AND (t.table_name IN ('companies','users','contacts','pipelines','stages','opportunities','conversations','messages','tasks','appointments','audit_logs')
 OR t.table_name LIKE 'crm_%')
ORDER BY t.table_name;
-- Revisar especialmente políticas permisivas y roles de aplicación.
SELECT schemaname,tablename,policyname,roles,cmd,permissive,qual,with_check
FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname;
-- Verificar funciones SECURITY DEFINER: propietario, búsqueda segura y permisos.
SELECT n.nspname AS schema_name,p.proname AS function_name,pg_get_userbyid(p.proowner) AS owner,
 p.prosecdef AS security_definer,p.proconfig AS function_settings
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.prosecdef ORDER BY p.proname;
-- Ejecutar scripts/tenant_preflight.sql por separado para contar referencias cruzadas.
