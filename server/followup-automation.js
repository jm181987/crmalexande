import {query} from './db.js';
// Internal tasks only: no customer messages are sent by automation.
export async function runFollowupAutomations({limit=50}={}){
 if(process.env.CRM_AUTOMATIONS_ENABLED!=='true')return {disabled:true,created:0};
 const rules=await query("SELECT id,company_id,name,config FROM crm_automation_rules WHERE enabled=true AND trigger_event='contact_inactive' AND action_type='create_task' ORDER BY created_at LIMIT 100");
 let created=0;
 for(const rule of rules.rows){
  const days=Number(rule.config?.days);
  if(!Number.isInteger(days)||days<1||days>365)continue;
  const tag=typeof rule.config?.tag==='string'&&rule.config.tag.length<=100?rule.config.tag:null;
  const contacts=await query(`SELECT c.id,c.owner_id FROM contacts c WHERE c.company_id=$1 AND c.owner_id IS NOT NULL
   AND ($3::text IS NULL OR $3=ANY(c.tags))
   AND NOT EXISTS (SELECT 1 FROM messages m JOIN conversations v ON v.id=m.conversation_id WHERE v.contact_id=c.id AND v.company_id=c.company_id AND m.created_at > now()-($2::int * interval '1 day'))
   AND NOT EXISTS (SELECT 1 FROM crm_automation_executions x WHERE x.rule_id=$4 AND x.contact_id=c.id AND x.period_date=current_date)
   AND c.created_at <= now()-($2::int * interval '1 day')
   ORDER BY c.id LIMIT $5`,[rule.company_id,days,tag,rule.id,Math.min(100,Math.max(1,limit))]);
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
