-- ZARKO CRM: run BEFORE deploying fail-closed permissions.
-- Preserve existing non-owner access; new users without assignments remain denied.
BEGIN;
INSERT INTO public.crm_user_module_permissions
 (company_id,user_id,module_key,can_view,can_create,can_edit,can_delete)
SELECT u.company_id,u.id,m.module_key,true,true,true,true
FROM public.users u
CROSS JOIN (VALUES
 ('dashboard'),('inventory'),('conversations'),('opportunities'),('contacts'),
 ('calendar'),('tasks'),('ai'),('automation'),('campaigns'),('reviews'),('reports'),('settings')
) AS m(module_key)
WHERE u.role <> 'owner' AND u.is_active = true
ON CONFLICT (company_id,user_id,module_key) DO NOTHING;
COMMIT;
-- Verify incomplete assignments before enabling the new backend:
SELECT u.company_id,u.id AS user_id,u.email,count(p.module_key) AS configured_modules
FROM public.users u
LEFT JOIN public.crm_user_module_permissions p
 ON p.company_id=u.company_id AND p.user_id=u.id
WHERE u.role <> 'owner' AND u.is_active=true
GROUP BY u.company_id,u.id,u.email
HAVING count(p.module_key) <> 13;
