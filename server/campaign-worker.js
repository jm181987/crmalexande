import {unsubscribeUrl} from './campaign-unsubscribe.js';
import {query} from './db.js';
const json=async r=>{const text=await r.text();if(!r.ok)throw Error('upstream_http_'+r.status);try{return JSON.parse(text)}catch{return {}}};
export async function dispatchCampaignBatch({limit=10}={}){
 if(process.env.CAMPAIGN_DELIVERY_ENABLED!=='true')return {disabled:true,processed:0};
 if(!process.env.CAMPAIGN_WORKER_SECRET||process.env.CAMPAIGN_WORKER_SECRET.length<24)throw Error('CAMPAIGN_WORKER_SECRET missing');
 const rows=await query("SELECT d.id,d.company_id,d.contact_id,d.campaign_id,c.channel,c.content,c.template_name,c.instance_name,ct.phone,ct.email,ct.name FROM crm_campaign_deliveries d JOIN crm_campaigns c ON c.id=d.campaign_id AND c.company_id=d.company_id JOIN contacts ct ON ct.id=d.contact_id AND ct.company_id=d.company_id JOIN crm_contact_consents co ON co.contact_id=ct.id AND co.company_id=d.company_id AND co.channel=c.channel AND co.opted_in=true WHERE (c.channel<>'email' OR NOT EXISTS (SELECT 1 FROM crm_email_suppressions s WHERE s.company_id=d.company_id AND s.email=lower(ct.email))) AND d.status='queued' AND d.due_at<=now() AND c.status='ready' AND (co.updated_at IS NOT NULL) AND (co.opted_in=true) AND (COALESCE(c.filters->>'type','')<>'quote_followup' OR NOT EXISTS (SELECT 1 FROM messages m JOIN conversations v ON v.id=m.conversation_id WHERE v.company_id=d.company_id AND v.contact_id=d.contact_id AND m.direction='inbound' AND m.created_at > c.scheduled_at - interval '24 hours')) ORDER BY d.due_at LIMIT $1",[Math.min(20,Math.max(1,limit))]);
 let processed=0,failed=0;
 for(const item of rows.rows){
  const claim=await query("UPDATE crm_campaign_deliveries d SET status='sending' WHERE d.id=$1 AND d.status='queued' AND EXISTS(SELECT 1 FROM crm_campaigns c JOIN crm_contact_consents co ON co.company_id=c.company_id AND co.contact_id=d.contact_id AND co.channel=c.channel AND co.opted_in=true WHERE c.id=d.campaign_id AND c.company_id=d.company_id AND c.status='ready') RETURNING id",[item.id]);
  if(!claim.rowCount)continue;
  try{
   let external=null;
   if(item.channel==='email'){
    if(!process.env.SENDGRID_API_KEY||!process.env.SENDGRID_FROM_EMAIL)throw Error('sendgrid_not_configured');
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(item.email||''))throw Error('invalid_email');
    const blocked=await query('SELECT 1 FROM crm_email_suppressions WHERE company_id=$1 AND email=lower($2) LIMIT 1',[item.company_id,item.email]);
    if(blocked.rowCount)throw Error('email_suppressed');
    const subject=String(item.template_name||'Información comercial').slice(0,150);
    const unsubscribe=unsubscribeUrl(item.company_id,item.contact_id);
    const body={headers:{'List-Unsubscribe':'<'+unsubscribe+'>'},personalizations:[{to:[{email:item.email}],custom_args:{campaign_delivery_id:item.id}}],from:{email:process.env.SENDGRID_FROM_EMAIL},subject,content:[{type:'text/plain',value:item.content+'\n\nPara cancelar suscripción: '+unsubscribe}],...(process.env.SENDGRID_REPLY_TO?{reply_to:{email:process.env.SENDGRID_REPLY_TO}}:{})};
    const r=await fetch('https://api.sendgrid.com/v3/mail/send',{method:'POST',headers:{Authorization:'Bearer '+process.env.SENDGRID_API_KEY,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
    if(r.status!==202)throw Error('sendgrid_http_'+r.status);
    external=r.headers.get('x-message-id');
   }else if(item.channel==='whatsapp'){
    if(!process.env.EVOLUTION_API_URL||!process.env.EVOLUTION_API_KEY||!item.instance_name)throw Error('evolution_not_configured');
    if(!/^\+?\d{8,15}$/.test(item.phone||''))throw Error('invalid_phone');
    const base=process.env.EVOLUTION_API_URL.replace(/\/$/,'');
    const response=await fetch(base+'/message/sendText/'+encodeURIComponent(item.instance_name),{method:'POST',headers:{apikey:process.env.EVOLUTION_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({number:item.phone.replace(/^\+/,''),text:item.content}),signal:AbortSignal.timeout(12000)});
    const data=await json(response);external=data.key?.id||null;
   }else throw Error('unsupported_channel');
   await query("UPDATE crm_campaign_deliveries SET status='sent',sent_at=now(),external_id=$2,error_code=NULL WHERE id=$1",[item.id,external]);
   processed++;
  }catch(err){
   await query("UPDATE crm_campaign_deliveries SET status='failed',error_code=$2 WHERE id=$1",[item.id,String(err.message||'delivery_failed').slice(0,100)]);
   failed++;
  }
 }
 return {processed,failed,selected:rows.rowCount};
}
