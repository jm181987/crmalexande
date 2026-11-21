import {query,pool} from './db.js';
const safe=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const manager=(req,res,next)=>['owner','manager'].includes(req.user.role)?next():res.sendStatus(403);
const channels=['whatsapp','email'];
const globalEmailAdmin=safe(async(req,res,next)=>{
 const found=await pool.query('SELECT 1 FROM public.crm_platform_admins a JOIN public.users u ON u.id=a.user_id WHERE a.user_id=$1 AND u.is_active=true',[req.user.id]);
 if(!found.rowCount)return res.status(403).json({error:'Solo los administradores globales pueden gestionar envíos de email'});
 next();
});
export function registerCampaignDelivery(app,auth){
 app.put('/api/campaign-consents/:contactId',auth,manager,safe(async(req,res)=>{
  const {channel='whatsapp',opted_in,source='manual'}=req.body||{};
  if(!channels.includes(channel)||typeof opted_in!=='boolean'||typeof source!=='string'||!source.trim()||source.length>100)return res.sendStatus(400);
  const contact=await query('SELECT id FROM contacts WHERE id=$1 AND company_id=$2',[req.params.contactId,req.user.company_id]);
  if(!contact.rowCount)return res.sendStatus(404);
  if(channel==='email'&&opted_in){
   const blocked=await query('SELECT 1 FROM crm_email_suppressions s JOIN contacts c ON c.company_id=s.company_id AND lower(c.email)=s.email WHERE c.company_id=$1 AND c.id=$2',[req.user.company_id,req.params.contactId]);
   if(blocked.rowCount)return res.status(409).json({error:'Email suppressed after bounce, spam report or unsubscribe'});
  }
  const x=await query('INSERT INTO crm_contact_consents(company_id,contact_id,channel,opted_in,source) VALUES($1,$2,$3,$4,$5) ON CONFLICT(company_id,contact_id,channel) DO UPDATE SET opted_in=EXCLUDED.opted_in,source=EXCLUDED.source,updated_at=now() RETURNING *',[req.user.company_id,req.params.contactId,channel,opted_in,source.trim()]);
  if(!opted_in)await query("UPDATE crm_campaign_deliveries SET status='skipped',error_code='opted_out' WHERE company_id=$1 AND contact_id=$2 AND status='queued' AND campaign_id IN (SELECT id FROM crm_campaigns WHERE company_id=$1 AND channel=$3)",[req.user.company_id,req.params.contactId,channel]);
  res.json(x.rows[0]);
 }));
 app.get('/api/campaigns/operations/status',auth,manager,(req,res)=>{
  res.json({
   dispatch_enabled:process.env.CAMPAIGN_DELIVERY_ENABLED==='true',
   automations_enabled:process.env.CRM_AUTOMATIONS_ENABLED==='true',
   worker_secret_configured:Boolean(process.env.CAMPAIGN_WORKER_SECRET?.length>=24),
   sendgrid_key_configured:Boolean(process.env.SENDGRID_API_KEY),
   sendgrid_sender_configured:Boolean(process.env.SENDGRID_FROM_EMAIL),
   sendgrid_webhook_key_configured:Boolean(process.env.SENDGRID_EVENT_PUBLIC_KEY),
   unsubscribe_configured:Boolean(process.env.CAMPAIGN_UNSUBSCRIBE_SECRET?.length>=32&&/^https:\/\//.test(process.env.PUBLIC_APP_URL||'')),
   evolution_configured:Boolean(process.env.EVOLUTION_API_URL&&process.env.EVOLUTION_API_KEY),
   scheduler_status:'not_verified'
  });
 });
 app.get('/api/sendgrid/config-check',auth,manager,(req,res)=>{
  const from=String(process.env.SENDGRID_FROM_EMAIL||'');
  res.json({provider:'sendgrid',api_key_configured:Boolean(process.env.SENDGRID_API_KEY),sender_configured:from.includes('@')&&from.includes('.'),reply_to_configured:Boolean(process.env.SENDGRID_REPLY_TO),automatic_dispatch:false});
 });
 app.get('/api/campaigns/email/recipients-preview',auth,globalEmailAdmin,safe(async(req,res)=>{
  const tag=String(req.query.tag||'').trim(),source=String(req.query.source||'').trim();
  if(tag.length>100||source.length>100)return res.status(400).json({error:'Filtro demasiado largo'});
  try{
   // Platform-wide read uses the privileged pool only after global-admin authorization.
   // Do not reuse tenant-scoped query() here: tenant RLS must remain intact elsewhere.
   const result=await pool.query(`WITH candidates AS (
    SELECT c.id,c.name,c.email,c.source,c.company_id,'client'::text AS recipient_type,
     EXISTS(SELECT 1 FROM public.crm_contact_consents co WHERE co.company_id=c.company_id AND co.contact_id=c.id AND co.channel='email' AND co.opted_in=false) AS opted_out
    FROM public.contacts c WHERE c.email IS NOT NULL AND trim(c.email)<>''
     AND ($1::text='' OR $1=ANY(coalesce(c.tags,ARRAY[]::text[])))
     AND ($2::text='' OR c.source=$2)
    UNION ALL
    SELECT u.id,u.name,u.email,'owner'::text,u.company_id,'owner'::text,false
    FROM public.users u WHERE u.role='owner' AND u.is_active=true AND u.email IS NOT NULL AND trim(u.email)<>''
     AND $1::text='' AND $2::text=''
   ), ranked AS (
    SELECT *,row_number() OVER (PARTITION BY lower(trim(email)) ORDER BY CASE WHEN recipient_type='client' THEN 0 ELSE 1 END,id) AS rn
    FROM candidates
   )
   SELECT r.id,r.name,r.email,r.source,r.company_id,r.recipient_type,r.opted_out,
    EXISTS(SELECT 1 FROM public.crm_email_suppressions s WHERE s.company_id=r.company_id AND s.email=lower(trim(r.email))) AS suppressed
   FROM ranked r WHERE rn=1 ORDER BY r.name,r.id LIMIT 5001`,[tag,source]);
   const validEmail=email=>/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(String(email||'').trim());
   const rows=result.rows.slice(0,5000).map(c=>({...c,eligible:validEmail(c.email)&&!c.suppressed&&!c.opted_out}));
   res.json({total:rows.length,eligible:rows.filter(c=>c.eligible).length,contacts:rows.slice(0,150),limited:result.rows.length>5000,scope:'global',diagnostics:{total_contacts:rows.length,with_email:rows.length,filters_active:Boolean(tag||source)}});
  }catch(e){
   console.error('Campaign email recipients preview failed',{company_id:req.user.company_id,code:e.code,message:e.message});
   if(e.code==='42P01')return res.status(503).json({error:'Falta una tabla necesaria para consultar los destinatarios de email. Revisá las migraciones del CRM.'});
   if(e.code==='42703')return res.status(503).json({error:'La estructura de contactos no coincide con la consulta de campañas. Revisá las migraciones.'});
   return res.status(500).json({error:'No se pudieron consultar los destinatarios del CRM. Revisá los logs del servidor.'});
  }
 }));
 app.get('/api/campaigns/:id/deliveries',auth,manager,safe(async(req,res)=>{
  const campaign=await query('SELECT id,name,status FROM crm_campaigns WHERE id=$1 AND company_id=$2',[req.params.id,req.user.company_id]);
  if(!campaign.rowCount)return res.sendStatus(404);
  const stats=await query('SELECT status,count(*)::int AS count FROM crm_campaign_deliveries WHERE campaign_id=$1 AND company_id=$2 GROUP BY status',[req.params.id,req.user.company_id]);
  res.json({campaign:campaign.rows[0],counts:stats.rows});
 }));
 const prepare=channel=>[auth,channel==='email'?globalEmailAdmin:manager,safe(async(req,res)=>{
  const {instance_name=null,scheduled_at,interval_seconds=180,tag=null,source=null,inactive_days=null,interest_tag=null,contact_ids=null,manual_email=null,manual_name=null}=req.body||{};
  if(manual_email!==null&&(channel!=='email'||typeof manual_email!=='string'||manual_email.length>254||! /^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(manual_email.trim())||contact_ids!==null))return res.status(400).json({error:'Invalid manual email recipient'});
  if(contact_ids!==null&&(!Array.isArray(contact_ids)||!contact_ids.length||contact_ids.length>5000||contact_ids.some(id=>typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id))||new Set(contact_ids).size!==contact_ids.length))return res.status(400).json({error:'Invalid selected contacts'});
  if((inactive_days!==null&&(!Number.isInteger(inactive_days)||inactive_days<1||inactive_days>3650))||(interest_tag!==null&&(typeof interest_tag!=='string'||interest_tag.length>100))||!Number.isInteger(interval_seconds)||interval_seconds<60||interval_seconds>86400||tag!==null&&(typeof tag!=='string'||tag.length>100)||source!==null&&(typeof source!=='string'||source.length>100))return res.status(400).json({error:'Invalid schedule or segment'});
  const when=new Date(scheduled_at);if(!scheduled_at||!Number.isFinite(when.getTime())||when.getTime()<Date.now()-60000)return res.status(400).json({error:'Invalid start date'});
  const campaign=await query('SELECT id,content,status FROM crm_campaigns WHERE id=$1 AND company_id=$2 AND channel=$3 AND status=$4',[req.params.id,req.user.company_id,channel,'draft']);
  if(!campaign.rowCount)return res.status(409).json({error:'Campaign not found or not in draft'});
  if(!campaign.rows[0].content.trim())return res.status(400).json({error:'Campaign message is empty'});
  if(channel==='whatsapp'){
   if(typeof instance_name!=='string'||!/^crm-[a-z0-9-]{3,50}$/.test(instance_name))return res.status(400).json({error:'Invalid instance'});
   const inst=await query('SELECT id FROM crm_evolution_instances WHERE company_id=$1 AND name=$2',[req.user.company_id,instance_name]);
   if(!inst.rowCount)return res.status(404).json({error:'Evolution instance not found'});
  }
  const old=await query('SELECT count(*)::int AS count FROM crm_campaign_deliveries WHERE campaign_id=$1',[req.params.id]);
  if(old.rows[0].count)return res.status(409).json({error:'Campaign already prepared'});
  let targetIds=contact_ids;
  if(manual_email!==null){
   const normalized=manual_email.trim().toLowerCase();
   const blocked=await query("SELECT 1 FROM crm_email_suppressions WHERE company_id=$1 AND email=$2 UNION ALL SELECT 1 FROM crm_contact_consents co JOIN contacts c ON c.id=co.contact_id AND c.company_id=co.company_id WHERE co.company_id=$1 AND lower(c.email)=$2 AND co.channel='email' AND co.opted_in=false LIMIT 1",[req.user.company_id,normalized]);
   if(blocked.rowCount)return res.status(409).json({error:'Email address opted out or suppressed'});
   let existing=await query('SELECT id FROM contacts WHERE company_id=$1 AND lower(email)=$2 ORDER BY created_at LIMIT 1',[req.user.company_id,normalized]);
   if(!existing.rowCount){
    const display=typeof manual_name==='string'&&manual_name.trim()?manual_name.trim().slice(0,150):normalized;
    existing=await query("INSERT INTO contacts(company_id,owner_id,name,email,source,tags,custom_fields) VALUES($1,$2,$3,$4,'manual_email_campaign',ARRAY[]::text[],'{}'::jsonb) RETURNING id",[req.user.company_id,req.user.id,display,normalized]);
   }
   targetIds=[existing.rows[0].id];
  }
  const contacts=await query(`SELECT c.id,c.phone,c.email FROM contacts c WHERE c.company_id=$1 AND ( $2 <> 'whatsapp' OR EXISTS (SELECT 1 FROM crm_contact_consents co WHERE co.company_id=c.company_id AND co.contact_id=c.id AND co.channel='whatsapp' AND co.opted_in=true)) AND ($2 <> 'email' OR NOT EXISTS (SELECT 1 FROM crm_contact_consents co WHERE co.company_id=c.company_id AND co.contact_id=c.id AND co.channel='email' AND co.opted_in=false)) AND ($3::text IS NULL OR $3=ANY(c.tags)) AND ($4::text IS NULL OR c.source=$4) AND ($5::int IS NULL OR (c.created_at <= now()-($5::int * interval '1 day') AND NOT EXISTS (SELECT 1 FROM messages m JOIN conversations v ON v.id=m.conversation_id WHERE v.company_id=c.company_id AND v.contact_id=c.id AND m.created_at > now()-($5::int * interval '1 day')))) AND ($6::text IS NULL OR $6=ANY(c.tags)) AND ($7::uuid[] IS NULL OR c.id=ANY($7::uuid[])) AND ($8::boolean=false OR NOT EXISTS (SELECT 1 FROM crm_email_suppressions s WHERE s.company_id=c.company_id AND s.email=lower(c.email))) ORDER BY c.id LIMIT 5000`,[req.user.company_id,channel,manual_email!==null?null:tag,manual_email!==null?null:source,manual_email!==null?null:inactive_days,manual_email!==null?null:interest_tag,targetIds,channel==='email']);
  const eligible=contacts.rows.filter(c=>channel==='whatsapp'?/^\\+?\\d{8,15}$/.test(String(c.phone||'')):/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(String(c.email||'')));
  if(!eligible.length)return res.status(409).json({error:'No eligible contacts (check opt-outs, suppressions and email validity)'});
  await query("UPDATE crm_campaigns SET instance_name=$3,scheduled_at=$4,interval_seconds=$5,filters=$6,status='ready' WHERE id=$1 AND company_id=$2",[req.params.id,req.user.company_id,instance_name,when.toISOString(),interval_seconds,JSON.stringify({tag,source,inactive_days,interest_tag,contact_ids:targetIds})]);
  for(let i=0;i<eligible.length;i++)await query('INSERT INTO crm_campaign_deliveries(company_id,campaign_id,contact_id,due_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[req.user.company_id,req.params.id,eligible[i].id,new Date(when.getTime()+i*interval_seconds*1000).toISOString()]);
  res.json({prepared:eligible.length,channel,automatic_dispatch:false,notice:'Queued, not sent. Worker disabled until explicitly configured.'});
 })];
 app.post('/api/quote-followups/prepare',auth,manager,safe(async(req,res)=>{
  const {contact_id,instance_name,messages,first_at}=req.body||{};
  if(!/^[0-9a-f-]{36}$/i.test(String(contact_id||''))||!/^crm-[a-z0-9-]{3,50}$/.test(String(instance_name||''))||!Array.isArray(messages)||messages.length!==3||messages.some(m=>typeof m!=='string'||!m.trim()||m.length>1500))return res.sendStatus(400);
  const first=first_at?new Date(first_at):new Date();
  if(!Number.isFinite(first.getTime())||first.getTime()<Date.now()-60000)return res.sendStatus(400);
  const eligible=await query("SELECT c.id FROM contacts c JOIN crm_contact_consents co ON co.company_id=c.company_id AND co.contact_id=c.id AND co.channel='whatsapp' AND co.opted_in=true WHERE c.id=$1 AND c.company_id=$2 AND c.phone IS NOT NULL AND length(regexp_replace(c.phone, '[^0-9]', '', 'g')) BETWEEN 8 AND 15",[contact_id,req.user.company_id]);
  if(!eligible.rowCount)return res.status(409).json({error:'WhatsApp opt-in and phone required'});
  const instance=await query('SELECT id FROM crm_evolution_instances WHERE company_id=$1 AND name=$2',[req.user.company_id,instance_name]);if(!instance.rowCount)return res.sendStatus(404);
  const existing=await query("SELECT 1 FROM crm_campaign_deliveries d JOIN crm_campaigns c ON c.id=d.campaign_id AND c.company_id=d.company_id WHERE d.company_id=$1 AND d.contact_id=$2 AND c.name LIKE 'Quote follow-up:%' AND d.status IN ('queued','sending') LIMIT 1",[req.user.company_id,contact_id]);if(existing.rowCount)return res.sendStatus(409);
  const queued=[];
  for(const [i,hours] of [24,72,168].entries()){
   const due=new Date(first.getTime()+hours*3600000).toISOString();
   const campaign=await query("INSERT INTO crm_campaigns(company_id,name,channel,content,instance_name,status,scheduled_at,interval_seconds,filters) VALUES($1,$2,'whatsapp',$3,$4,'ready',$5,180,$6) RETURNING id",[req.user.company_id,'Quote follow-up: '+contact_id+' step '+(i+1),messages[i].trim(),instance_name,due,JSON.stringify({type:'quote_followup',step:i+1,contact_id})]);
   await query('INSERT INTO crm_campaign_deliveries(company_id,campaign_id,contact_id,due_at) VALUES($1,$2,$3,$4)',[req.user.company_id,campaign.rows[0].id,contact_id,due]);
   queued.push({campaign_id:campaign.rows[0].id,step:i+1,due_at:due});
  }
  res.status(201).json({queued,automatic_dispatch:false});
 }));
 app.post('/api/campaigns/:id/prepare',...prepare('whatsapp'));
 app.post('/api/campaigns/:id/prepare-email',...prepare('email'));


 // Financial inputs are explicitly entered by a manager; never infer costs or margin.
 app.put('/api/campaigns/:id/financials',auth,manager,safe(async(req,res)=>{
  const {cost,margin_pct}=req.body||{};
  if(typeof cost!=='number'||!Number.isFinite(cost)||cost<0||cost>1000000000||
   typeof margin_pct!=='number'||!Number.isFinite(margin_pct)||margin_pct<0||margin_pct>100)
   return res.status(400).json({error:'Invalid campaign cost or gross margin'});
  const x=await query(`UPDATE crm_campaigns SET filters=jsonb_set(
   coalesce(filters,'{}'::jsonb),'{financials}',$3::jsonb)
   WHERE id=$1 AND company_id=$2 RETURNING id,filters`,
   [req.params.id,req.user.company_id,JSON.stringify({cost,margin_pct})]);
  if(!x.rowCount)return res.sendStatus(404);
  res.json({id:x.rows[0].id,financials:x.rows[0].filters.financials});
 }));

 // Explicit opt-in recurrence. Only prepared campaigns can be scheduled; no auto-send unless worker is enabled.
 app.put('/api/campaigns/:id/recurrence',auth,manager,safe(async(req,res)=>{
  const {enabled=false,every_days=30,next_run_at=null,max_cycles=6}=req.body||{};
  if(typeof enabled!=='boolean'||(enabled&&(!Number.isInteger(every_days)||every_days<7||every_days>365||
   !Number.isInteger(max_cycles)||max_cycles<1||max_cycles>24)))return res.status(400).json({error:'Invalid recurrence'});
  const campaign=await query("SELECT id,status,channel,filters FROM crm_campaigns WHERE id=$1 AND company_id=$2",[req.params.id,req.user.company_id]);
  if(!campaign.rowCount)return res.sendStatus(404);
  if(enabled&&(!['whatsapp','email'].includes(campaign.rows[0].channel)||campaign.rows[0].status!=='ready'))
   return res.status(409).json({error:'Prepare the campaign before enabling recurrence'});
  const next=enabled?new Date(next_run_at):null;
  if(enabled&&(!next_run_at||!Number.isFinite(next.getTime())||next.getTime()<Date.now()+60000))
   return res.status(400).json({error:'Choose a future recurrence date'});
  const filters={...(campaign.rows[0].filters||{})};
  if(enabled)filters.recurrence={enabled:true,every_days,max_cycles,cycles:0,next_run_at:next.toISOString()};
  else delete filters.recurrence;
  const updated=await query('UPDATE crm_campaigns SET filters=$3::jsonb WHERE id=$1 AND company_id=$2 RETURNING id,filters',[req.params.id,req.user.company_id,JSON.stringify(filters)]);
  res.json({id:updated.rows[0].id,recurrence:updated.rows[0].filters.recurrence||{enabled:false}});
 }));

 app.post('/api/campaigns/:id/pause',auth,manager,safe(async(req,res)=>{
  const x=await query("UPDATE crm_campaigns SET status='paused' WHERE id=$1 AND company_id=$2 AND status='ready' RETURNING id,status",[req.params.id,req.user.company_id]);if(!x.rowCount)return res.sendStatus(409);res.json(x.rows[0]);
 }));
}
