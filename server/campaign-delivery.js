import {query} from './db.js';
const safe=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const manager=(req,res,next)=>['owner','manager'].includes(req.user.role)?next():res.sendStatus(403);
const channels=['whatsapp','email'];
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
 app.get('/api/campaigns/email/recipients-preview',auth,manager,safe(async(req,res)=>{
  const tag=String(req.query.tag||'').trim(),source=String(req.query.source||'').trim();
  if(tag.length>100||source.length>100)return res.status(400).json({error:'Filtro demasiado largo'});
  const result=await query(`SELECT c.id,c.name,c.email,c.source,
    EXISTS(SELECT 1 FROM crm_contact_consents co WHERE co.company_id=c.company_id AND co.contact_id=c.id AND co.channel='email' AND co.opted_in=false) AS opted_out,
    EXISTS(SELECT 1 FROM crm_email_suppressions s WHERE s.company_id=c.company_id AND s.email=lower(c.email)) AS suppressed
    FROM contacts c WHERE c.company_id=$1 AND c.email IS NOT NULL AND trim(c.email)<>'' 
    AND ($2::text='' OR $2=ANY(c.tags)) AND ($3::text='' OR c.source=$3)
    ORDER BY c.name,c.id LIMIT 5000`,[req.user.company_id,tag,source]);
  const validEmail=email=>/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(String(email||''));
  const rows=result.rows.map(c=>({...c,eligible:validEmail(c.email)&&!c.suppressed&&!c.opted_out}));
  res.json({total:rows.length,eligible:rows.filter(c=>c.eligible).length,contacts:rows.slice(0,150),limited:result.rowCount===5000});
 }));
 app.get('/api/campaigns/:id/deliveries',auth,manager,safe(async(req,res)=>{
  const campaign=await query('SELECT id,name,status FROM crm_campaigns WHERE id=$1 AND company_id=$2',[req.params.id,req.user.company_id]);
  if(!campaign.rowCount)return res.sendStatus(404);
  const stats=await query('SELECT status,count(*)::int AS count FROM crm_campaign_deliveries WHERE campaign_id=$1 AND company_id=$2 GROUP BY status',[req.params.id,req.user.company_id]);
  res.json({campaign:campaign.rows[0],counts:stats.rows});
 }));
 const prepare=channel=>[auth,manager,safe(async(req,res)=>{
  const {instance_name=null,scheduled_at,interval_seconds=180,tag=null,source=null,inactive_days=null,interest_tag=null,contact_ids=null}=req.body||{};
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
  const contacts=await query(`SELECT c.id,c.phone,c.email FROM contacts c WHERE c.company_id=$1 AND ( $2 <> 'whatsapp' OR EXISTS (SELECT 1 FROM crm_contact_consents co WHERE co.company_id=c.company_id AND co.contact_id=c.id AND co.channel='whatsapp' AND co.opted_in=true)) AND ($2 <> 'email' OR NOT EXISTS (SELECT 1 FROM crm_contact_consents co WHERE co.company_id=c.company_id AND co.contact_id=c.id AND co.channel='email' AND co.opted_in=false)) AND ($3::text IS NULL OR $3=ANY(c.tags)) AND ($4::text IS NULL OR c.source=$4) AND ($5::int IS NULL OR (c.created_at <= now()-($5::int * interval '1 day') AND NOT EXISTS (SELECT 1 FROM messages m JOIN conversations v ON v.id=m.conversation_id WHERE v.company_id=c.company_id AND v.contact_id=c.id AND m.created_at > now()-($5::int * interval '1 day')))) AND ($6::text IS NULL OR $6=ANY(c.tags)) AND ($7::uuid[] IS NULL OR c.id=ANY($7::uuid[])) AND ($8::boolean=false OR NOT EXISTS (SELECT 1 FROM crm_email_suppressions s WHERE s.company_id=c.company_id AND s.email=lower(c.email))) ORDER BY c.id LIMIT 5000`,[req.user.company_id,channel,tag,source,inactive_days,interest_tag,contact_ids,channel==='email']);
  const eligible=contacts.rows.filter(c=>channel==='whatsapp'?/^\\+?\\d{8,15}$/.test(String(c.phone||'')):/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(String(c.email||'')));
  if(!eligible.length)return res.status(409).json({error:'No eligible contacts (check opt-outs, suppressions and email validity)'});
  await query("UPDATE crm_campaigns SET instance_name=$3,scheduled_at=$4,interval_seconds=$5,filters=$6,status='ready' WHERE id=$1 AND company_id=$2",[req.params.id,req.user.company_id,instance_name,when.toISOString(),interval_seconds,JSON.stringify({tag,source,inactive_days,interest_tag,contact_ids})]);
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
 app.post('/api/campaigns/:id/pause',auth,manager,safe(async(req,res)=>{
  const x=await query("UPDATE crm_campaigns SET status='paused' WHERE id=$1 AND company_id=$2 AND status='ready' RETURNING id,status",[req.params.id,req.user.company_id]);if(!x.rowCount)return res.sendStatus(409);res.json(x.rows[0]);
 }));
}
