import crypto from 'node:crypto';
import {query,tenantContext} from './db.js';
const safe=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const cfg=()=>({url:(process.env.EVOLUTION_API_URL||'').replace(/\/$/,''),key:process.env.EVOLUTION_API_KEY,origin:(process.env.PUBLIC_APP_URL|| (process.env.VERCEL_PROJECT_PRODUCTION_URL?'https://'+process.env.VERCEL_PROJECT_PRODUCTION_URL:'')).replace(/\/$/,'')});
const ready=e=>(e.url.startsWith('https://')||(process.env.EVOLUTION_ALLOW_INSECURE_HTTP==='true'&&/^http:\/\/(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?$/.test(e.url)))&&Boolean(e.key);
const webhookReady=e=>ready(e)&&e.origin.startsWith('https://');
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
 app.get('/api/evolution/config-check',auth,admin,(req,res)=>{const e=cfg();res.json({evolution_url_set:Boolean(e.url),evolution_https:e.url.startsWith('https://'),insecure_http_opt_in:process.env.EVOLUTION_ALLOW_INSECURE_HTTP==='true',api_key_set:Boolean(e.key),public_app_url_set:Boolean(e.origin),public_app_https:e.origin.startsWith('https://'),ready:Boolean(webhookReady(e)),api_ready:Boolean(ready(e)),hint:'Check Production environment and redeploy after changing variables. Values and secrets are never returned.'})});
 app.get('/api/evolution/instances',auth,safe(async(req,res)=>{const x=await query('SELECT id,name,label,status,created_at FROM crm_evolution_instances WHERE company_id=$1 ORDER BY created_at DESC',[req.user.company_id]);res.json(x.rows)}));
 // Remove only obsolete CRM registrations. Never disconnect or delete a live Evolution instance.
 app.delete('/api/evolution/instances/:id',auth,admin,safe(async(req,res)=>{
  const found=await query('SELECT id,name FROM crm_evolution_instances WHERE id=$1 AND company_id=$2',[req.params.id,req.user.company_id]);
  if(!found.rowCount)return res.sendStatus(404);
  const e=cfg();if(!webhookReady(e))return res.status(503).json({error:'Evolution configuration incomplete'});
  try{
   await remote(e,'/instance/connectionState/'+encodeURIComponent(found.rows[0].name));
   return res.status(409).json({error:'La instancia todavía existe en Evolution. Solo se pueden quitar registros de instancias antiguas no encontradas (404).'});
  }catch(err){if(err.upstreamStatus!==404)throw err}
  await query('DELETE FROM crm_evolution_instances WHERE id=$1 AND company_id=$2',[req.params.id,req.user.company_id]);
  res.json({removed:true,name:found.rows[0].name,history_preserved:true});
 }));
 app.post('/api/evolution/instances',auth,admin,safe(async(req,res)=>{
 const e=cfg(),label=req.body?.label,name=req.body?.name;if(!webhookReady(e))return res.status(503).json({error:'Evolution configuration incomplete',details:{evolution_url_set:Boolean(e.url),evolution_https:e.url.startsWith('https://'),insecure_http_opt_in:process.env.EVOLUTION_ALLOW_INSECURE_HTTP==='true',api_key_set:Boolean(e.key),public_app_url_set:Boolean(e.origin),public_app_https:e.origin.startsWith('https://')},hint:'PUBLIC_APP_URL can be set to the HTTPS CRM origin; VERCEL_PROJECT_PRODUCTION_URL is also supported.'});
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
 const e=cfg();if(!ready(e))return res.status(503).json({error:'Evolution configuration incomplete',code:'configuration'});
 let d;
 try{d=await remote(e,'/instance/connectionState/'+encodeURIComponent(x.rows[0].name))}
 catch(err){if(err.upstreamStatus===404)return res.json({state:'not_found',source:'evolution',hint:'Instance not found in the configured Evolution API; verify whether this is an old instance',checked_at:new Date().toISOString()});throw err}
 const state=String(d.instance?.state||d.instance?.connectionStatus||d.state||d.connectionStatus||d.status||'unknown').toLowerCase();
 // The upstream connection state is authoritative; stored webhook state may be stale.
 res.json({state,source:'evolution',checked_at:new Date().toISOString()});
 }));
 // Read-only diagnostics: never expose webhook URL or secret.
 app.get('/api/evolution/instances/:id/diagnostics',auth,admin,safe(async(req,res)=>{
  const row=await query('SELECT name,webhook_secret_hash FROM crm_evolution_instances WHERE id=$1 AND company_id=$2',[req.params.id,req.user.company_id]);
  if(!row.rowCount)return res.sendStatus(404);
  const e=cfg();if(!ready(e))return res.status(503).json({error:'Evolution configuration incomplete'});
  const name=row.rows[0].name;
  const connection=await remote(e,'/instance/connectionState/'+encodeURIComponent(name));
  let webhook=null,webhookError=null;
  try{
   const response=await remote(e,'/webhook/find/'+encodeURIComponent(name));
   const w=response.webhook||response;
   const url=String(w.url||'');
   const secret=url.match(/\/api\/webhooks\/evolution\/([a-f0-9]{64})(?:[/?#]|$)/i)?.[1];
   const events=Array.isArray(w.events)?w.events:[];
   webhook={enabled:w.enabled===true||w.enabled==='true',url_host_matches:url.startsWith(e.origin+'/api/webhooks/evolution/'),secret_matches:secret?digest(secret)===row.rows[0].webhook_secret_hash:false,messages_upsert_enabled:events.some(x=>String(x).toUpperCase().replace(/[.]/g,'_')==='MESSAGES_UPSERT')};
  }catch(err){webhookError=err.message}
  const counts=await query("SELECT (SELECT COUNT(*)::int FROM conversations WHERE company_id=$1 AND channel='whatsapp' AND external_id LIKE $2) AS conversations,(SELECT COUNT(*)::int FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.company_id=$1 AND c.channel='whatsapp' AND c.external_id LIKE $2 AND m.direction='inbound') AS inbound_messages",[req.user.company_id,name+':%']);
  res.json({instance:name,state:connection.instance?.state||connection.state||'unknown',webhook,webhook_error:webhookError,stored:counts.rows[0]});
 }));
 app.get('/api/evolution/instances/:id/connect',auth,admin,safe(async(req,res)=>{
 const x=await query('SELECT name FROM crm_evolution_instances WHERE id=$1 AND company_id=$2',[req.params.id,req.user.company_id]);if(!x.rowCount)return res.sendStatus(404);
 const e=cfg();if(!ready(e))return res.sendStatus(503);const d=await remote(e,'/instance/connect/'+encodeURIComponent(x.rows[0].name));res.json({base64:d.base64||d.qrcode?.base64||null,code:d.code||d.qrcode?.code||null});
 }));
 // Reapply the existing webhook configuration without rotating its secret or reconnecting WhatsApp.
 app.post('/api/evolution/instances/:id/repair-webhook',auth,admin,safe(async(req,res)=>{
  const row=await query('SELECT name,webhook_secret_hash FROM crm_evolution_instances WHERE id=$1 AND company_id=$2',[req.params.id,req.user.company_id]);
  if(!row.rowCount)return res.sendStatus(404);
  const e=cfg();if(!ready(e))return res.status(503).json({error:'Evolution configuration incomplete'});
  const name=row.rows[0].name;
  const current=await remote(e,'/webhook/find/'+encodeURIComponent(name));
  const w=current.webhook||current,url=String(w.url||'');
  const prefix=e.origin+'/api/webhooks/evolution/';
  if(!url.startsWith(prefix))return res.status(409).json({error:'La URL del webhook no corresponde al dominio actual. No se modificó nada.'});
  const token=url.slice(prefix.length);
  if(!/^[a-f0-9]{64}$/i.test(token)||digest(token)!==row.rows[0].webhook_secret_hash)return res.status(409).json({error:'El secreto del webhook no coincide. No se modificó nada.'});
  await remote(e,'/webhook/set/'+encodeURIComponent(name),'POST',{webhook:{enabled:true,url,webhookByEvents:false,events:['MESSAGES_UPSERT','CONNECTION_UPDATE']}});
  const check=await remote(e,'/webhook/find/'+encodeURIComponent(name));
  const saved=check.webhook||check;
  const events=Array.isArray(saved.events)?saved.events:[];
  const eventOk=events.some(x=>String(x).toUpperCase().replace(/[.]/g,'_')==='MESSAGES_UPSERT');
  const valid=(saved.enabled===true||saved.enabled==='true')&&saved.url===url&&eventOk;
  console.info('Evolution webhook configuration reapplied',{instance:name,verified:valid,messagesUpsert:eventOk});
  res.json({updated:true,verified:valid,instance:name,messages_upsert_enabled:eventOk,notice:'Webhook reconfigurado con el mismo secreto. No se desconectó WhatsApp. Enviá un mensaje real para verificar la entrega.'});
 }));
 // Synthetic delivery test: validates the public route and stored secret without creating chats.
 app.post('/api/evolution/instances/:id/test-webhook',auth,admin,safe(async(req,res)=>{
  const row=await query('SELECT name,webhook_secret_hash FROM crm_evolution_instances WHERE id=$1 AND company_id=$2',[req.params.id,req.user.company_id]);
  if(!row.rowCount)return res.sendStatus(404);
  const e=cfg();if(!ready(e))return res.sendStatus(503);
  const response=await remote(e,'/webhook/find/'+encodeURIComponent(row.rows[0].name));
  const w=response.webhook||response,url=String(w.url||'');
  const expected=e.origin+'/api/webhooks/evolution/';
  if(!url.startsWith(expected))return res.status(409).json({error:'La URL configurada no corresponde al dominio público del CRM'});
  const secret=url.slice(expected.length);
  if(!/^[a-f0-9]{64}$/i.test(secret)||digest(secret)!==row.rows[0].webhook_secret_hash)return res.status(409).json({error:'El secreto configurado no coincide'});
  let result;try{result=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({instance:row.rows[0].name,event:'crm.probe',data:{}}),signal:AbortSignal.timeout(12000),redirect:'manual'})}
  catch(err){return res.status(502).json({error:'No se pudo contactar la URL pública del webhook',detail:err.name})}
  const contentType=String(result.headers.get('content-type')||'').slice(0,80);
  const vercelId=Boolean(result.headers.get('x-vercel-id'));
  const receiverMarker=result.headers.get('x-alexandre-evolution-webhook')==='v1';
  const authHeader=String(result.headers.get('www-authenticate')||'').slice(0,100);
  const redirect=String(result.headers.get('location')||'');
  const responseText=await result.text().catch(()=> '');
  const vercelProtection=/vercel authentication|authentication required|deployment protection|vercel sso/i.test(responseText);
  let responseError=null,responseCode=null;
  try{const parsed=JSON.parse(responseText);if(parsed&&typeof parsed==='object'){responseError=typeof parsed.error==='string'?parsed.error.slice(0,120):typeof parsed.message==='string'?parsed.message.slice(0,120):null;responseCode=typeof parsed.code==='string'?parsed.code.slice(0,80):null}}catch{}
  // Never return raw upstream body, URL, tokens, or request headers.
  res.json({http_status:result.status,response_error:responseError,response_code:responseCode,reachable:result.status===200,content_type:contentType,vercel_edge:vercelId,receiver_reached:receiverMarker,vercel_protection_page:vercelProtection,auth_challenge:authHeader||null,redirect_to_login:/login|auth|sso/i.test(redirect),origin_host:new URL(e.origin).host,notice:'Prueba desde el servidor CRM; no verifica la entrega desde Evolution ni crea mensajes'});
 }));
 app.post('/api/webhooks/evolution/:secret',safe(async(req,res)=>{
 res.set('X-Alexandre-Evolution-Webhook','v1');
 console.info('Evolution webhook HTTP request received',{event:String(req.body?.event||'missing').slice(0,60)});
 const hash=digest(req.params.secret),found=process.env.TENANT_RLS_ENABLED==='true'?await query('SELECT * FROM public.crm_webhook_instance_by_hash($1)',[hash]):await query('SELECT id,company_id,name FROM crm_evolution_instances WHERE webhook_secret_hash=$1',[hash]);if(!found.rowCount){console.warn('Evolution webhook rejected: unknown secret hash');return res.sendStatus(403)}
 const inst=found.rows[0],payload=req.body;tenantContext.enterWith({companyId:inst.company_id});if(payload?.instance!==inst.name){console.warn('Evolution webhook instance mismatch',{expected:inst.name});return res.sendStatus(200)}
 const event=String(payload.event||'').toLowerCase().replace(/_/g,'.');if(event==='connection.update'){const state=String(payload.data?.state||'unknown').slice(0,30);await query('UPDATE crm_evolution_instances SET status=$2 WHERE id=$1',[inst.id,state]);return res.sendStatus(200)}
 if(event!=='messages.upsert')return res.sendStatus(200);
 console.info('Evolution inbound event received',{instance:inst.name,items:Array.isArray(payload.data)?payload.data.length:1});
 for(const item of Array.isArray(payload.data)?payload.data:[payload.data]){
 const key=item?.key||{},jid=String(key.remoteJid||'');
 // Evolution may supply a WhatsApp LID and a separate phone JID. Never treat a LID as a phone number.
 if(!key.id||key.fromMe||jid.endsWith('@g.us')||jid==='status@broadcast')continue;
 const candidates=[key.remoteJid,key.remoteJidAlt,item?.remoteJidAlt,item?.participantAlt].filter(x=>typeof x==='string');
 const phoneJid=candidates.find(x=>/^\d{8,15}@s\.whatsapp\.net$/.test(x));
 const lidJid=candidates.find(x=>/^\d{5,25}@lid$/.test(x));
 if(!phoneJid&&!lidJid){console.warn('Evolution inbound skipped: unsupported sender JID', {instance:inst.name,jidType:jid.split('@')[1]||'missing'});continue}
 // Keep LID-only chats instead of silently dropping them. A LID is NOT a telephone number.
 const phone=phoneJid?phoneJid.split('@')[0]:'lid:'+lidJid.split('@')[0];
 const external=inst.name+':'+key.id;
 if((await query('SELECT id FROM messages WHERE external_id=$1',[external])).rowCount)continue;
 let c=await query('SELECT id FROM contacts WHERE company_id=$1 AND phone=$2 LIMIT 1',[inst.company_id,phone]);
 if(!c.rowCount)c=await query("INSERT INTO contacts(company_id,name,phone,source) VALUES($1,$2,$3,'whatsapp') RETURNING id",[inst.company_id,String(item.pushName||phone).slice(0,200),phone]);
 let conv=await query("SELECT id FROM conversations WHERE company_id=$1 AND channel='whatsapp' AND external_id=$2 LIMIT 1",[inst.company_id,inst.name+':'+phone]);
 if(!conv.rowCount){
  conv=await query("INSERT INTO conversations(company_id,contact_id,channel,external_id) VALUES($1,$2,'whatsapp',$3) RETURNING id",[inst.company_id,c.rows[0].id,inst.name+':'+phone]);
  // Assign only newly opened chats. Manual assignments are never overwritten.
  try{await query('SELECT public.crm_assign_round_robin($1,$2)',[inst.company_id,conv.rows[0].id])}
  catch(err){console.error('Round Robin assignment failed',err.code||err.message)}
 }
 const m=item.message||{},body=m.conversation||m.extendedTextMessage?.text||('[WhatsApp '+String(item.messageType||'media')+']');
 const saved=await query("INSERT INTO messages(conversation_id,direction,body,external_id) VALUES($1,'inbound',$2,$3) ON CONFLICT DO NOTHING RETURNING id",[conv.rows[0].id,String(body).slice(0,10000),external]);
 if(saved.rowCount){await query('UPDATE conversations SET unread_count=unread_count+1,updated_at=now() WHERE id=$1',[conv.rows[0].id]);console.info('Evolution inbound stored',{instance:inst.name})}
 }res.sendStatus(200);
 }));
 app.post('/api/conversations/:id/evolution-send',auth,safe(async(req,res)=>{
 const body=req.body?.body;if(typeof body!=='string'||!body.trim()||body.length>4096)return res.status(400).json({error:'Invalid message'});
 const args=[req.params.id,req.user.company_id,...(req.user.role==='agent'?[req.user.id]:[])];
 const c=await query("SELECT external_id FROM conversations WHERE id=$1 AND company_id=$2 AND channel='whatsapp'"+(req.user.role==='agent'?' AND assignee_id=$3':''),args);if(!c.rowCount)return res.sendStatus(404);
 const match=/^(crm-[a-z0-9-]{3,50}):(\d{8,15}|lid:\d{5,25})$/.exec(c.rows[0].external_id||'');if(!match)return res.status(409).json({error:'Conversation not linked to an Evolution instance'});
 const inst=await query('SELECT id FROM crm_evolution_instances WHERE company_id=$1 AND name=$2',[req.user.company_id,match[1]]);if(!inst.rowCount)return res.sendStatus(403);
 const e=cfg();if(!ready(e))return res.sendStatus(503);
 if(match[2].startsWith('lid:'))return res.status(409).json({error:'This chat uses a WhatsApp LID without a verified phone number. Reply requires resolving its phone JID first.'});
 const sent=await remote(e,'/message/sendText/'+encodeURIComponent(match[1]),'POST',{number:match[2],text:body.trim()});
 const x=await query("INSERT INTO messages(conversation_id,sender_id,direction,body,external_id) VALUES($1,$2,'outbound',$3,$4) RETURNING *",[req.params.id,req.user.id,body.trim(),sent.key?.id?match[1]+':'+sent.key.id:null]);res.status(201).json(x.rows[0]);
 }));
}
