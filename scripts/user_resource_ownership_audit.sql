-- Read-only. Run after user_resource_ownership.sql.
SELECT 'inventory_unassigned' AS metric, count(*)::bigint AS total
FROM crm_inventory_items WHERE created_by IS NULL
UNION ALL
SELECT 'inventory_cross_company_creator',count(*)::bigint
FROM crm_inventory_items i JOIN users u ON u.id=i.created_by WHERE u.company_id<>i.company_id
UNION ALL
SELECT 'instances_unassigned',count(*)::bigint
FROM crm_evolution_instances WHERE owner_user_id IS NULL
UNION ALL
SELECT 'instances_cross_company_owner',count(*)::bigint
FROM crm_evolution_instances i JOIN users u ON u.id=i.owner_user_id WHERE u.company_id<>i.company_id;
SELECT i.id,i.company_id,i.name,i.label,i.owner_user_id
FROM crm_evolution_instances i WHERE i.owner_user_id IS NULL ORDER BY i.company_id,i.name;
