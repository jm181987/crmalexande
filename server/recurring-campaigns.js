import {query} from './db.js';

// Recurrence creates a new campaign for each cycle, preserving per-cycle delivery and conversion audit.
// Explicitly enabled by a manager and gated by the existing worker feature flags.
export async function runRecurringCampaigns({limit=10}={}){
 if(process.env.CRM_AUTOMATIONS_ENABLED!=='true'||process.env.CAMPAIGN_DELIVERY_ENABLED!=='true')
  return {disabled:true,created:0};
 const due=await query(`SELECT id,company_id,name,channel,content,template_name,instance_name,interval_seconds,
  filters FROM crm_campaigns WHERE status='ready'
  AND filters->'recurrence'->>'enabled'='true'
  AND (filters->'recurrence'->>'next_run_at')::timestamptz<=now()
  ORDER BY (filters->'recurrence'->>'next_run_at')::timestamptz LIMIT $1`,
  [Math.min(20,Math.max(1,limit))]);
 let created=0,recipients=0;
 for(const campaign of due.rows){
  const r=campaign.filters?.recurrence||{};
  const days=Number(r.every_days),cycles=Number(r.cycles),max=Number(r.max_cycles);
  if(!Number.isInteger(days)||days<7||days>365||!Number.isInteger(cycles)||
    !Number.isInteger(max)||max<1||max>24||cycles>=max)continue;
  const scheduled=new Date(r.next_run_at);
  if(!Number.isFinite(scheduled.getTime()))continue;
  const next=new Date(scheduled.getTime()+days*86400000);
  // Atomic claim: no other scheduler can create the same cycle.
  const claim=await query(`UPDATE crm_campaigns SET filters=jsonb_set(filters,'{recurrence}',
   $3::jsonb) WHERE id=$1 AND company_id=$2 AND status='ready'
   AND filters->'recurrence'->>'next_run_at'=$4 RETURNING id`,
   [campaign.id,campaign.company_id,JSON.stringify({...r,cycles:cycles+1,
    enabled:cycles+1<max,next_run_at:next.toISOString()}),r.next_run_at]);
  if(!claim.rowCount)continue;
  try{
   const run=await query(`INSERT INTO crm_campaigns(company_id,name,channel,content,template_name,
    instance_name,status,scheduled_at,interval_seconds,filters)
    VALUES($1,$2,$3,$4,$5,$6,'ready',now(),$7,$8::jsonb) RETURNING id`,
    [campaign.company_id,campaign.name+' · cycle '+(cycles+1),campaign.channel,
     campaign.content,campaign.template_name,campaign.instance_name,campaign.interval_seconds,
     JSON.stringify({type:'recurring_cycle',parent_campaign_id:campaign.id,cycle:cycles+1})]);
   const added=await query(`INSERT INTO crm_campaign_deliveries(company_id,campaign_id,contact_id,due_at)
    SELECT d.company_id,$2,d.contact_id,now()+
      (row_number() over(ORDER BY d.contact_id)-1)*($3::int*interval '1 second')
    FROM crm_campaign_deliveries d JOIN contacts ct
      ON ct.id=d.contact_id AND ct.company_id=d.company_id
    WHERE d.campaign_id=$1 AND d.company_id=$4
      AND ( $5::text<>'whatsapp' OR EXISTS(SELECT 1 FROM crm_contact_consents co
       WHERE co.company_id=d.company_id AND co.contact_id=d.contact_id
       AND co.channel='whatsapp' AND co.opted_in=true))
      AND ( $5::text<>'email' OR NOT EXISTS(SELECT 1 FROM crm_contact_consents co
       WHERE co.company_id=d.company_id AND co.contact_id=d.contact_id
       AND co.channel='email' AND co.opted_in=false))
      AND ( $5::text<>'email' OR NOT EXISTS(SELECT 1 FROM crm_email_suppressions s
       WHERE s.company_id=d.company_id AND s.email=lower(ct.email)))
    ON CONFLICT DO NOTHING RETURNING id`,
    [campaign.id,run.rows[0].id,campaign.interval_seconds||180,campaign.company_id,campaign.channel]);
   created++;recipients+=added.rowCount;
  }catch(e){console.error('Recurring campaign cycle failed',campaign.id,e.code||e.message)}
 }
 return {created,recipients};
}
