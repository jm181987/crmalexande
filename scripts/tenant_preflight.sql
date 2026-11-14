-- Read-only preflight: run before scripts/tenant_integrity.sql.
-- Each row reports cross-company references already present.
SELECT 'contacts.owner_id' AS relation,count(*) AS violations FROM contacts c JOIN users u ON u.id=c.owner_id WHERE c.company_id<>u.company_id
UNION ALL SELECT 'opportunities.contact_id',count(*) FROM opportunities o JOIN contacts c ON c.id=o.contact_id WHERE o.company_id<>c.company_id
UNION ALL SELECT 'opportunities.pipeline_id',count(*) FROM opportunities o JOIN pipelines p ON p.id=o.pipeline_id WHERE o.company_id<>p.company_id
UNION ALL SELECT 'opportunities.owner_id',count(*) FROM opportunities o JOIN users u ON u.id=o.owner_id WHERE o.company_id<>u.company_id
UNION ALL SELECT 'opportunities.stage_id',count(*) FROM opportunities o JOIN stages s ON s.id=o.stage_id WHERE o.pipeline_id<>s.pipeline_id
UNION ALL SELECT 'conversations.contact_id',count(*) FROM conversations v JOIN contacts c ON c.id=v.contact_id WHERE v.company_id<>c.company_id
UNION ALL SELECT 'conversations.assignee_id',count(*) FROM conversations v JOIN users u ON u.id=v.assignee_id WHERE v.company_id<>u.company_id
UNION ALL SELECT 'tasks.contact_id',count(*) FROM tasks t JOIN contacts c ON c.id=t.contact_id WHERE t.company_id<>c.company_id
UNION ALL SELECT 'tasks.owner_id',count(*) FROM tasks t JOIN users u ON u.id=t.owner_id WHERE t.company_id<>u.company_id
UNION ALL SELECT 'appointments.contact_id',count(*) FROM appointments a JOIN contacts c ON c.id=a.contact_id WHERE a.company_id<>c.company_id
UNION ALL SELECT 'appointments.owner_id',count(*) FROM appointments a JOIN users u ON u.id=a.owner_id WHERE a.company_id<>u.company_id
ORDER BY relation;
