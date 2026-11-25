import {query} from './db.js';
// Internal tasks only: no customer messages are sent by automation.
export async function runFollowupAutomations({limit=50}={}){
 if(process.env.CRM_AUTOMATIONS_ENABLED!=='true')return {disabled:true,created:0};
 const safeLimit=Math.min(100,Math.max(1,Number(limit)||50));
 const rules=await query("SELECT id,company_id,name,config FROM crm_automation_rules WHERE enabled=true AND trigger_event IN ('contact_inactive','opportunity_status') AND action_type='create_task' ORDER BY created_at LIMIT 100");
 let created=0;
 // First three open Kanban stages only. A follow-up is due when the most recent
 // customer-visible message is outbound and has not been answered within N days.
 const noReplyRules=await query("SELECT id,company_id,name,config FROM crm_automation_rules WHERE enabled=true AND trigger_event='opportunity_no_reply' AND action_type='create_task' ORDER BY created_at LIMIT 100");
 for(const rule of noReplyRules.rows){
  const days=Number(rule.config?.days);
  if(!Number.isInteger(days)||days<1||days>30)continue;
  const candidates=await query(`WITH ranked AS (
    SELECT s.id,s.pipeline_id,row_number() OVER(PARTITION BY s.pipeline_id ORDER BY s.position,s.id) AS rank
    FROM stages s JOIN pipelines p ON p.id=s.pipeline_id WHERE p.company_id=$1
   ), last_messages AS (
    SELECT v.contact_id,m.direction,m.created_at,
      row_number() OVER(PARTITION BY v.contact_id ORDER BY m.created_at DESC,m.id DESC) AS rn
    FROM conversations v JOIN messages m ON m.conversation_id=v.id
    WHERE v.company_id=$1 AND v.channel='whatsapp' AND m.direction IN ('inbound','outbound')
   )
   SELECT DISTINCT ON (c.id) c.id,coalesce(o.owner_id,c.owner_id) AS owner_id
   FROM opportunities o JOIN ranked s ON s.id=o.stage_id AND s.pipeline_id=o.pipeline_id AND s.rank<=3 AND s.status='open'
   JOIN contacts c ON c.id=o.contact_id AND c.company_id=o.company_id
   JOIN last_messages lm ON lm.contact_id=c.id AND lm.rn=1
   WHERE o.company_id=$1 AND o.deleted_at IS NULL AND o.status='open'
     AND lm.direction='outbound' AND lm.created_at<=now()-($2::int*interval '1 day')
     AND coalesce(o.owner_id,c.owner_id) IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM crm_automation_executions x JOIN tasks t ON t.id=x.task_id WHERE x.rule_id=$3 AND x.contact_id=c.id AND t.completed=false)
     AND NOT EXISTS (SELECT 1 FROM crm_automation_executions x WHERE x.rule_id=$3 AND x.contact_id=c.id AND x.period_date=current_date)
   ORDER BY c.id,o.created_at DESC LIMIT $4`,[rule.company_id,days,rule.id,safeLimit]);
  for(const contact of candidates.rows){
   const claim=await query('INSERT INTO crm_automation_executions(rule_id,contact_id,period_date) VALUES($1,$2,current_date) ON CONFLICT DO NOTHING RETURNING rule_id',[rule.id,contact.id]);
   if(!claim.rowCount)continue;
   try{
    const task=await query('INSERT INTO tasks(company_id,contact_id,owner_id,title,due_at) VALUES($1,$2,$3,$4,now()) RETURNING id',[rule.company_id,contact.id,contact.owner_id,'Sin respuesta ('+days+' días): '+rule.name.slice(0,120)]);
    await query('UPDATE crm_automation_executions SET task_id=$3 WHERE rule_id=$1 AND contact_id=$2 AND period_date=current_date',[rule.id,contact.id,task.rows[0].id]);
    created++;
   }catch(err){
    await query('DELETE FROM crm_automation_executions WHERE rule_id=$1 AND contact_id=$2 AND period_date=current_date AND task_id IS NULL',[rule.id,contact.id]);
    throw err;
   }
  }
 }
 for(const rule of rules.rows){
  const days=Number(rule.config?.days);
  if(!Number.isInteger(days)||days<1||days>365)continue;
  const status=rule.trigger_event==='opportunity_status'?rule.config?.status:null;
  if(status!==null&&!['open','won','lost','abandoned'].includes(status))continue;
  const tag=typeof rule.config?.tag==='string'&&rule.config.tag.length<=100?rule.config.tag:null;
  const contacts=await query(`SELECT c.id,c.owner_id FROM contacts c WHERE c.company_id=$1 AND c.owner_id IS NOT NULL
   AND ($3::text IS NULL OR $3=ANY(c.tags))
   AND ($6::text IS NOT NULL OR NOT EXISTS (SELECT 1 FROM messages m JOIN conversations v ON v.id=m.conversation_id WHERE v.contact_id=c.id AND v.company_id=c.company_id AND m.created_at > now()-($2::int * interval '1 day')))
   AND NOT EXISTS (SELECT 1 FROM crm_automation_executions x JOIN tasks t ON t.id=x.task_id WHERE x.rule_id=$4 AND x.contact_id=c.id AND t.completed=false)
   AND NOT EXISTS (SELECT 1 FROM crm_automation_executions x WHERE x.rule_id=$4 AND x.contact_id=c.id AND x.period_date=current_date)
   AND ($6::text IS NOT NULL OR c.created_at <= now()-($2::int * interval '1 day'))
   AND ($6::text IS NULL OR EXISTS (SELECT 1 FROM opportunities o WHERE o.contact_id=c.id AND o.company_id=c.company_id AND o.status=$6 AND o.updated_at<=now()-($2::int * interval '1 day')))
   ORDER BY c.id LIMIT $5`,[rule.company_id,days,tag,rule.id,safeLimit,status]);
  for(const contact of contacts.rows){
   // Atomic claim: parallel cron executions cannot create duplicate tasks for same day.
   const claim=await query('INSERT INTO crm_automation_executions(rule_id,contact_id,period_date) VALUES($1,$2,current_date) ON CONFLICT DO NOTHING RETURNING rule_id',[rule.id,contact.id]);
   if(!claim.rowCount)continue;
   try{
    const task=await query('INSERT INTO tasks(company_id,contact_id,owner_id,title,due_at) VALUES($1,$2,$3,$4,now()) RETURNING id',[rule.company_id,contact.id,contact.owner_id,'Seguimiento: '+rule.name.slice(0,140)]);
    await query('UPDATE crm_automation_executions SET task_id=$3 WHERE rule_id=$1 AND contact_id=$2 AND period_date=current_date',[rule.id,contact.id,task.rows[0].id]);
    created++;
   }catch(err){
    await query('DELETE FROM crm_automation_executions WHERE rule_id=$1 AND contact_id=$2 AND period_date=current_date AND task_id IS NULL',[rule.id,contact.id]);
    throw err;
   }
  }
 }
 return {created,rules:rules.rowCount};
}
