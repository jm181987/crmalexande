import {query} from './db.js';
const safe=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const manager=(req,res,next)=>['owner','manager'].includes(req.user.role)?next():res.sendStatus(403);
const validPhone=s=>/^\d{8,15}$/.test(String(s||'').replace(/^\+/,''));
export function registerCampaignDelivery(app,auth){
 app.put('/api/campaign-consents/:contactId',auth,manager,safe(async(req,res)=>{
  const {channel='whatsapp',opted_in,source='manual'}=req.body||{};
  if(channel!=='whatsapp'||typeof opted_in!=='boolean'||typeof source!=='string'||!source.trim()||source.length>100)return res.sendStatus(400);
  const contact=await query('SELECT id FROM contacts WHERE id=$1 AND company_id=$2',[req.params.contactId,req.user.company_id]);
  if(!contact.rowCount)return res.sendStatus(404);
  const x=await query("INSERT INTO crm_contact_consents(company_id,contact_id,channel,opted_in,source) VALUES($1,$2,'whatsapp',$3,$4) ON CONFLICT(company_id,contact_id,channel) DO UPDATE SET opted_in=EXCLUDED.opted_in,source=EXCLUDED.source,updated_at=now() RETURNING *",[req.user.company_id,req.params.contactId,opted_in,source.trim()]);
  if(!opted_in)await query("UPDATE crm_campaign_deliveries SET status='skipped',error_code='opted_out' WHERE company_id=$1 AND contact_id=$2 AND status='queued'",[req.user.company_id,req.params.contactId]);
  res.json(x.rows[0]);
 }));
 app.get('/api/campaigns/:id/deliveries',auth,manager,safe(async(req,res)=>{
  const campaign=await query('SELECT id,name,status FROM crm_campaigns WHERE id=$1 AND company_id=$2',[req.params.id,req.user.company_id]);
  if(!campaign.rowCount)return res.sendStatus(404);
  const stats=await query('SELECT status,count(*)::int AS count FROM crm_campaign_deliveries WHERE campaign_id=$1 AND company_id=$2 GROUP BY status',[req.params.id,req.user.company_id]);
  res.json({campaign:campaign.rows[0],counts:stats.rows});
 }));
 app.post('/api/campaigns/:id/prepare',auth,manager,safe(async(req,res)=>{
  const {instance_name,scheduled_at,interval_seconds=180,tag=null,source=null}=req.body||{};
  if(typeof instance_name!=='string'||!/^crm-[a-z0-9-]{3,50}$/.test(instance_name)||!Number.isInteger(interval_seconds)||interval_seconds<60||interval_seconds>86400||tag!==null&&(typeof tag!=='string'||tag.length>100)||source!==null&&(typeof source!=='string'||source.length>100))return res.status(400).json({error:'Invalid schedule or segment'});
  const when=new Date(scheduled_at);if(!scheduled_at||!Number.isFinite(when.getTime())||when.getTime()<Date.now()-60000)return res.status(400).json({error:'Invalid start date'});
  const campaign=await query("SELECT id,content,status FROM crm_campaigns WHERE id=$1 AND company_id=$2 AND channel='whatsapp' AND status IN ('draft','ready')",[req.params.id,req.user.company_id]);
  if(!campaign.rowCount)return res.status(409).json({error:'Campaign not found or already started'});
  if(!campaign.rows[0].content.trim())return res.status(400).json({error:'Campaign message is empty'});
  const inst=await query('SELECT id FROM crm_evolution_instances WHERE company_id=$1 AND name=$2',[req.user.company_id,instance_name]);if(!inst.rowCount)return res.status(404).json({error:'Evolution instance not found'});
  const contacts=await query("SELECT c.id,c.phone FROM contacts c JOIN crm_contact_consents co ON co.company_id=c.company_id AND co.contact_id=c.id AND co.channel='whatsapp' AND co.opted_in=true WHERE c.company_id=$1 AND c.phone ~ '^\\+?[0-9]{8,15}$' AND ($2::text IS NULL OR $2=ANY(c.tags)) AND ($3::text IS NULL OR c.source=$3) ORDER BY c.id LIMIT 5000",[req.user.company_id,tag,source]);
  const eligible=contacts.rows.filter(c=>validPhone(c.phone));
  if(!eligible.length)return res.status(409).json({error:'No eligible opted-in contacts'});
  const old=await query('SELECT count(*)::int AS count FROM crm_campaign_deliveries WHERE campaign_id=$1',[req.params.id]);if(old.rows[0].count)return res.status(409).json({error:'Campaign already has prepared recipients'});
  await query("UPDATE crm_campaigns SET instance_name=$3,scheduled_at=$4,interval_seconds=$5,filters=$6,status='ready' WHERE id=$1 AND company_id=$2",[req.params.id,req.user.company_id,instance_name,when.toISOString(),interval_seconds,JSON.stringify({tag,source})]);
  for(let i=0;i<eligible.length;i++){
   await query("INSERT INTO crm_campaign_deliveries(company_id,campaign_id,contact_id,due_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",[req.user.company_id,req.params.id,eligible[i].id,new Date(when.getTime()+i*interval_seconds*1000).toISOString()]);
  }
  res.json({prepared:eligible.length,first_due_at:when.toISOString(),interval_seconds,automatic_dispatch:false,notice:'Campaign queued. Delivery worker is not enabled yet; no messages have been sent.'});
 }));
 app.post('/api/campaigns/:id/pause',auth,manager,safe(async(req,res)=>{
  const x=await query("UPDATE crm_campaigns SET status='paused' WHERE id=$1 AND company_id=$2 AND status='ready' RETURNING id,status",[req.params.id,req.user.company_id]);
  if(!x.rowCount)return res.sendStatus(409);res.json(x.rows[0]);
 }));
}
