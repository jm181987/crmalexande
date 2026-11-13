import crypto from 'node:crypto';
import {query} from './db.js';
const safe=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const configured=()=>Boolean(process.env.WHATSAPP_APP_SECRET&&process.env.WHATSAPP_VERIFY_TOKEN&&process.env.WHATSAPP_ACCESS_TOKEN&&process.env.WHATSAPP_PHONE_NUMBER_ID&&process.env.WHATSAPP_COMPANY_ID);
const authSignature=(raw,signature)=>{if(!process.env.WHATSAPP_APP_SECRET||!signature?.startsWith('sha256='))return false;const expected='sha256='+crypto.createHmac('sha256',process.env.WHATSAPP_APP_SECRET).update(raw).digest('hex');const a=Buffer.from(expected),b=Buffer.from(signature);return a.length===b.length&&crypto.timingSafeEqual(a,b)};
export function registerWhatsApp(app,auth){
 app.get('/api/webhooks/whatsapp',(req,res)=>{const ok=process.env.WHATSAPP_VERIFY_TOKEN&&req.query['hub.mode']==='subscribe'&&req.query['hub.verify_token']===process.env.WHATSAPP_VERIFY_TOKEN;if(!ok)return res.sendStatus(403);res.status(200).type('text/plain').send(String(req.query['hub.challenge']||''))});
 app.post('/api/webhooks/whatsapp',safe(async(req,res)=>{
 if(!authSignature(req.body,req.get('x-hub-signature-256')))return res.sendStatus(403);
 if(!configured())return res.sendStatus(503);
 let event;try{event=JSON.parse(req.body.toString('utf8'))}catch{return res.sendStatus(400)}
 if(event.object!=='whatsapp_business_account')return res.sendStatus(200);
 for(const entry of event.entry||[])for(const change of entry.changes||[]){
 const v=change.value||{};if(change.field!=='messages'||v.metadata?.phone_number_id!==process.env.WHATSAPP_PHONE_NUMBER_ID)continue;
 for(const m of v.messages||[]){
 if(!m.id||!m.from)continue;
 const company=process.env.WHATSAPP_COMPANY_ID,phone=m.from,name=v.contacts?.find(c=>c.wa_id===phone)?.profile?.name||phone;
 const existing=await query('SELECT id FROM messages WHERE external_id=$1',[m.id]);if(existing.rowCount)continue;
 let contact=await query('SELECT id FROM contacts WHERE company_id=$1 AND phone=$2 ORDER BY created_at LIMIT 1',[company,phone]);
 if(!contact.rowCount)contact=await query("INSERT INTO contacts(company_id,name,phone,source) VALUES($1,$2,$3,'whatsapp') RETURNING id",[company,name,phone]);
 let conv=await query("SELECT id FROM conversations WHERE company_id=$1 AND channel='whatsapp' AND external_id=$2 ORDER BY created_at LIMIT 1",[company,phone]);
 if(!conv.rowCount)conv=await query("INSERT INTO conversations(company_id,contact_id,channel,external_id) VALUES($1,$2,'whatsapp',$3) RETURNING id",[company,contact.rows[0].id,phone]);
 const body=m.type==='text'?m.text?.body||'':('[WhatsApp '+String(m.type||'unknown')+' message]');
 const saved=await query("INSERT INTO messages(conversation_id,direction,body,external_id) VALUES($1,'inbound',$2,$3) ON CONFLICT DO NOTHING RETURNING id",[conv.rows[0].id,body.slice(0,10000),m.id]);
 if(saved.rowCount)await query('UPDATE conversations SET unread_count=unread_count+1,updated_at=now() WHERE id=$1',[conv.rows[0].id]);
 }
 }
 res.sendStatus(200);
 }));
 app.get('/api/whatsapp/status',auth,(req,res)=>res.json({configured:configured()&&req.user.company_id===process.env.WHATSAPP_COMPANY_ID,provider:'meta_cloud_api'}));
 app.post('/api/conversations/:id/whatsapp-send',auth,safe(async(req,res)=>{
 if(!configured()||req.user.company_id!==process.env.WHATSAPP_COMPANY_ID)return res.status(503).json({error:'WhatsApp provider not configured for this company'});
 const body=req.body?.body;if(typeof body!=='string'||!body.trim()||body.length>4096)return res.status(400).json({error:'Invalid message'});
 const args=[req.params.id,req.user.company_id,...(req.user.role==='agent'?[req.user.id]:[])];
 const c=await query("SELECT id,external_id FROM conversations WHERE id=$1 AND company_id=$2 AND channel='whatsapp'"+(req.user.role==='agent'?' AND assignee_id=$3':''),args);
 if(!c.rowCount)return res.status(404).json({error:'WhatsApp conversation unavailable'});
 const recent=await query("SELECT id FROM messages WHERE conversation_id=$1 AND direction='inbound' AND created_at>=now()-interval '24 hours' LIMIT 1",[c.rows[0].id]);
 if(!recent.rowCount)return res.status(409).json({error:'24-hour customer service window closed. Use an approved template.'});
 const version=process.env.WHATSAPP_API_VERSION||'v23.0';
 const url='https://graph.facebook.com/'+encodeURIComponent(version)+'/'+encodeURIComponent(process.env.WHATSAPP_PHONE_NUMBER_ID)+'/messages';
 let response;try{response=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+process.env.WHATSAPP_ACCESS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:c.rows[0].external_id,type:'text',text:{body:body.trim()}}),signal:AbortSignal.timeout(12000)})}catch{return res.status(502).json({error:'WhatsApp provider unreachable'})}
 const result=await response.json().catch(()=>({}));if(!response.ok||!result.messages?.[0]?.id)return res.status(502).json({error:'WhatsApp provider rejected message',provider_code:result.error?.code||null});
 const m=await query("INSERT INTO messages(conversation_id,sender_id,direction,body,external_id) VALUES($1,$2,'outbound',$3,$4) ON CONFLICT DO NOTHING RETURNING *",[c.rows[0].id,req.user.id,body.trim(),result.messages[0].id]);
 await query('UPDATE conversations SET updated_at=now() WHERE id=$1',[c.rows[0].id]);res.status(201).json(m.rows[0]||{accepted:true});
 }));
}
