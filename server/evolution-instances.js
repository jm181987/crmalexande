import crypto from 'node:crypto';
import {query} from './db.js';
const safe=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const cfg=()=>({url:(process.env.EVOLUTION_API_URL||'').replace(/\/$/,''),key:process.env.EVOLUTION_API_KEY,origin:(process.env.PUBLIC_APP_URL|| (process.env.VERCEL_PROJECT_PRODUCTION_URL?'https://'+process.env.VERCEL_PROJECT_PRODUCTION_URL:'')).replace(/\/$/,'')});
const ready=e=>(e.url.startsWith('https://')||(process.env.EVOLUTION_ALLOW_INSECURE_HTTP==='true'&&/^http:\/\/(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?$/.test(e.url)))&&Boolean(e.key)&&e.origin.startsWith('https://');
const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
const admin=(req,res,next)=>req.user.role==='agent'?res.sendStatus(403):next();
async function remote(e,path,method='GET',body){
 let response;
 try{response=await fetch(e.url+path,{method,headers:{apikey:e.key,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(12000)})}
 catch(err){console.error('Evolution network error',err?.cause?.code||err?.code||err?.name);throw Object.assign(new Error('Evolution API unreachable or timed out'),{status:502,phase:'network'})}
 const data=await response.json().catch(()=>({}));
 if(!response.ok){console.error('Evolution HTTP error',response.status,path.split('/').slice(0,3).join('/'));throw Object.assign(new Error('Evolution API returned HTTP '+response.status),{status:502,phase:'upstream',upstreamStatus:response.status})}
 return data;
}
export function registerEvolutionInstances(app,auth){
 app.get('/api/evolution/config-check',auth,admin,(req,res)=>{const e=cfg();res.json({evolution_url_set:Boolean(e.url),evolution_https:e.url.startsWith('https://'),insecure_http_opt_in:process.env.EVOLUTION_ALLOW_INSECURE_HTTP==='true',api_key_set:Boolean(e.key),public_app_url_set:Boolean(e.origin),public_app_https:e.origin.startsWith('https://'),ready:Boolean(ready(e)),hint:'Check Production environment and redeploy after changing variables. Values and secrets are never returned.'})});
 app.get('/api/evolution/instances',auth,safe(async(req,res)=>{const x=await query('SELECT id,name,label,status,created_at FROM crm_evolution_instances WHERE company_id=$1 ORDER BY created_at DESC',[req.user.company_id]);res.json(x.rows)}));
 app.post('/api/evolution/instances',auth,admin,safe(async(req,res)=>{
 const e=cfg(),label=req.body?.label,name=req.body?.name;if(!ready(e))return res.status(503).json({error:'Evolution configuration incomplete',details:{evolution_url_set:Boolean(e.url),evolution_https:e.url.startsWith('https://'),insecure_http_opt_in:process.env.EVOLUTION_ALLOW_INSECURE_HTTP==='true',api_key_set:Boolean(e.key),public_app_url_set:Boolean(e.origin),public_app_https:e.origin.startsWith('https://')},hint:'PUBLIC_APP_URL can be set to the HTTPS CRM origin; VERCEL_PROJECT_PRODUCTION_URL is also supported.'});
 if(typeof label!=='string'||!label.trim()||label.length>100||typeof name!=='string'||!/^crm-[a-z0-9-]{3,50}$/.test(name))return res.status(400).json({error:'Use a unique instance name starting crm-'});
 const existing=await query('SELECT id FROM crm_evolution_instances WHERE name=$1',[name]);if(existing.rowCount)return res.status(409).json({error:'Instance name already exists'});
 const secret=crypto.randomBytes(32).toString('hex'),url=e.origin+'/api/webhooks/evolution/'+secret;
 let created;try{created=await remote(e,'/instance/create','POST',{instanceName:name,integration:'WHATSAPP-BAILEYS',qrcode:true})}catch(err){return res.status(502).json({error:err.message,phase:'instance_create',upstreamStatus:err.upstreamStatus||null})}
 try{await remote(e,'/webhook/set/'+encodeURIComponent(name),'POST',{webhook:{enabled:true,url,webhookByEvents:false,events:['MESSAGES_UPSERT','CONNECTION_UPDATE']}})}
 catch(err){return res.status(502).json({error:'Instance created remotely but webhook setup failed',phase:'webhook_setup',upstreamStatus:err.upstreamStatus||null,instance:name})}
 const row=await query('INSERT INTO crm_evolution_instances(company_id,name,label,webhook_secret_hash,status) VALUES($1,$2,$3,$4,$5) RETURNING id,name,label,status,created_at',[req.user.company_id,name,label.trim(),digest(secret),'created']);
 res.status(201).json({...row.rows[0],qrcode:created.qrcode||null});
 }));
 app.get('/api/evolution/instances/:id/status',auth,safe(async(req,res)=>{
 const x=await query('SELECT name FROM crm_evolution_instances WHERE id=$1 AND company_id=$2',[req.params.id,req.user.company_id]);if(!x.rowCount)return res.sendStatus(404);
 const e=cfg();if(!ready(e))return res.sendStatus(503);const d=await remote(e,'/instance/connectionState/'+encodeURIComponent(x.rows[0].name));res.json({state:d.instance?.state||d.state||'unknown'});
 }));
 app.get('/api/evolution/instances/:id/connect',auth,admin,safe(async(req,res)=>{
 const x=await query('SELECT name FROM crm_evolution_instances WHERE id=$1 AND company_id=$2',[req.params.id,req.user.company_id]);if(!x.rowCount)return res.sendStatus(404);
 const e=cfg();if(!ready(e))return res.sendStatus(503);const d=await remote(e,'/instance/connect/'+encodeURIComponent(x.rows[0].name));res.json({base64:d.base64||d.qrcode?.base64||null,code:d.code||d.qrcode?.code||null});
 }));
 app.post('/api/webhooks/evolution/:secret',safe(async(req,res)=>{
 const hash=digest(req.params.secret),found=await query('SELECT id,company_id,name FROM crm_evolution_instances WHERE webhook_secret_hash=$1',[hash]);if(!found.rowCount)return res.sendStatus(403);
 const inst=found.rows[0],payload=req.body;if(payload?.instance!==inst.name)return res.sendStatus(200);
 const event=String(payload.event||'').toLowerCase().replace(/_/g,'.');if(event==='connection.update'){const state=String(payload.data?.state||'unknown').slice(0,30);await query('UPDATE crm_evolution_instances SET status=$2 WHERE id=$1',[inst.id,state]);return res.sendStatus(200)}
 if(event!=='messages.upsert')return res.sendStatus(200);
 for(const item of Array.isArray(payload.data)?payload.data:[payload.data]){
 const key=item?.key||{},jid=key.remoteJid||'';if(!key.id||key.fromMe||!jid.endsWith('@s.whatsapp.net'))continue;
 const phone=jid.split('@')[0];if(!/^\d{8,15}$/.test(phone))continue;
 const external=inst.name+':'+key.id;
 if((await query('SELECT id FROM messages WHERE external_id=$1',[external])).rowCount)continue;
 let c=await query('SELECT id FROM contacts WHERE company_id=$1 AND phone=$2 LIMIT 1',[inst.company_id,phone]);
 if(!c.rowCount)c=await query("INSERT INTO contacts(company_id,name,phone,source) VALUES($1,$2,$3,'whatsapp') RETURNING id",[inst.company_id,String(item.pushName||phone).slice(0,200),phone]);
 let conv=await query("SELECT id FROM conversations WHERE company_id=$1 AND channel='whatsapp' AND external_id=$2 LIMIT 1",[inst.company_id,inst.name+':'+phone]);
 if(!conv.rowCount)conv=await query("INSERT INTO conversations(company_id,contact_id,channel,external_id) VALUES($1,$2,'whatsapp',$3) RETURNING id",[inst.company_id,c.rows[0].id,inst.name+':'+phone]);
 const m=item.message||{},body=m.conversation||m.extendedTextMessage?.text||('[WhatsApp '+String(item.messageType||'media')+']');
 const saved=await query("INSERT INTO messages(conversation_id,direction,body,external_id) VALUES($1,'inbound',$2,$3) ON CONFLICT DO NOTHING RETURNING id",[conv.rows[0].id,String(body).slice(0,10000),external]);
 if(saved.rowCount)await query('UPDATE conversations SET unread_count=unread_count+1,updated_at=now() WHERE id=$1',[conv.rows[0].id]);
 }res.sendStatus(200);
 }));
 app.post('/api/conversations/:id/evolution-send',auth,safe(async(req,res)=>{
 const body=req.body?.body;if(typeof body!=='string'||!body.trim()||body.length>4096)return res.status(400).json({error:'Invalid message'});
 const args=[req.params.id,req.user.company_id,...(req.user.role==='agent'?[req.user.id]:[])];
 const c=await query("SELECT external_id FROM conversations WHERE id=$1 AND company_id=$2 AND channel='whatsapp'"+(req.user.role==='agent'?' AND assignee_id=$3':''),args);if(!c.rowCount)return res.sendStatus(404);
 const match=/^(crm-[a-z0-9-]{3,50}):(\d{8,15})$/.exec(c.rows[0].external_id||'');if(!match)return res.status(409).json({error:'Conversation not linked to an Evolution instance'});
 const inst=await query('SELECT id FROM crm_evolution_instances WHERE company_id=$1 AND name=$2',[req.user.company_id,match[1]]);if(!inst.rowCount)return res.sendStatus(403);
 const e=cfg();if(!ready(e))return res.sendStatus(503);
 const sent=await remote(e,'/message/sendText/'+encodeURIComponent(match[1]),'POST',{number:match[2],text:body.trim()});
 const x=await query("INSERT INTO messages(conversation_id,sender_id,direction,body,external_id) VALUES($1,$2,'outbound',$3,$4) RETURNING *",[req.params.id,req.user.id,body.trim(),sent.key?.id?match[1]+':'+sent.key.id:null]);res.status(201).json(x.rows[0]);
 }));
}
