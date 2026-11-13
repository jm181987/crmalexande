import crypto from 'node:crypto';
import {query} from './db.js';
const safe=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const env=()=>({url:(process.env.EVOLUTION_API_URL||'').replace(/\/$/,''),key:process.env.EVOLUTION_API_KEY,instance:process.env.EVOLUTION_INSTANCE,company:process.env.EVOLUTION_COMPANY_ID,hook:process.env.EVOLUTION_WEBHOOK_SECRET});
const enabled=e=>Boolean(e.url?.startsWith('https://')&&e.key&&e.instance&&e.company&&e.hook);
const equal=(a,b)=>{const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&crypto.timingSafeEqual(x,y)};
export function registerEvolution(app,auth){
 app.post('/api/webhooks/evolution/:secret',safe(async(req,res)=>{
 const e=env();if(!enabled(e)||!equal(req.params.secret,e.hook))return res.sendStatus(403);
 const payload=req.body;if(!payload||typeof payload!=='object'||payload.instance!==e.instance)return res.sendStatus(200);
 const type=String(payload.event||'').toLowerCase().replace(/_/g,'.');if(type!=='messages.upsert')return res.sendStatus(200);
 const entries=Array.isArray(payload.data)?payload.data:[payload.data];for(const item of entries){
 const m=item?.message||{},key=item?.key||{},jid=key.remoteJid||'';if(!key.id||key.fromMe||!jid.endsWith('@s.whatsapp.net'))continue;
 const phone=jid.split('@')[0];if(!/^\d{8,15}$/.test(phone))continue;
 const external=e.instance+':'+key.id;const found=await query('SELECT id FROM messages WHERE external_id=$1',[external]);if(found.rowCount)continue;
 let c=await query('SELECT id FROM contacts WHERE company_id=$1 AND phone=$2 LIMIT 1',[e.company,phone]);
 if(!c.rowCount)c=await query("INSERT INTO contacts(company_id,name,phone,source) VALUES($1,$2,$3,'whatsapp') RETURNING id",[e.company,String(item.pushName||phone).slice(0,200),phone]);
 let conversation=await query("SELECT id FROM conversations WHERE company_id=$1 AND channel='whatsapp' AND external_id=$2 LIMIT 1",[e.company,phone]);
 if(!conversation.rowCount)conversation=await query("INSERT INTO conversations(company_id,contact_id,channel,external_id) VALUES($1,$2,'whatsapp',$3) RETURNING id",[e.company,c.rows[0].id,phone]);
 const body=m.conversation||m.extendedTextMessage?.text||('[WhatsApp '+String(item.messageType||'media')+']');
 const saved=await query("INSERT INTO messages(conversation_id,direction,body,external_id) VALUES($1,'inbound',$2,$3) ON CONFLICT DO NOTHING RETURNING id",[conversation.rows[0].id,String(body).slice(0,10000),external]);
 if(saved.rowCount)await query('UPDATE conversations SET unread_count=unread_count+1,updated_at=now() WHERE id=$1',[conversation.rows[0].id]);
 }res.sendStatus(200);
 }));
 app.get('/api/evolution/status',auth,(req,res)=>{const e=env();res.json({configured:enabled(e)&&req.user.company_id===e.company,provider:'evolution_api',instance:enabled(e)&&req.user.company_id===e.company?e.instance:null})});
 app.post('/api/conversations/:id/evolution-send',auth,safe(async(req,res)=>{
 const e=env();if(!enabled(e)||req.user.company_id!==e.company)return res.status(503).json({error:'Evolution API not configured with HTTPS'});
 const body=req.body?.body;if(typeof body!=='string'||!body.trim()||body.length>4096)return res.status(400).json({error:'Invalid message'});
 const args=[req.params.id,req.user.company_id,...(req.user.role==='agent'?[req.user.id]:[])];
 const c=await query("SELECT id,external_id FROM conversations WHERE id=$1 AND company_id=$2 AND channel='whatsapp'"+(req.user.role==='agent'?' AND assignee_id=$3':''),args);
 if(!c.rowCount)return res.status(404).json({error:'Conversation unavailable'});
 if(!/^\d{8,15}$/.test(c.rows[0].external_id))return res.status(400).json({error:'Invalid destination'});
 let response;try{response=await fetch(e.url+'/message/sendText/'+encodeURIComponent(e.instance),{method:'POST',headers:{apikey:e.key,'Content-Type':'application/json'},body:JSON.stringify({number:c.rows[0].external_id,text:body.trim()}),signal:AbortSignal.timeout(12000)})}catch{return res.status(502).json({error:'Evolution API unreachable'})}
 const result=await response.json().catch(()=>({}));if(!response.ok)return res.status(502).json({error:'Evolution API rejected message',status:response.status});
 const externalId=result.key?.id?e.instance+':'+result.key.id:null;
 const saved=await query("INSERT INTO messages(conversation_id,sender_id,direction,body,external_id) VALUES($1,$2,'outbound',$3,$4) RETURNING *",[c.rows[0].id,req.user.id,body.trim(),externalId]);
 await query('UPDATE conversations SET updated_at=now() WHERE id=$1',[c.rows[0].id]);res.status(201).json(saved.rows[0]);
 }));
}
