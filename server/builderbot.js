import {createCipheriv,createDecipheriv,createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {query} from './db.js';
const base='https://app.builderbot.cloud/api/v2/';
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const uuid=s=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const owner=(req,res,next)=>req.user.role==='owner'?next():res.sendStatus(403);
const operator=(req,res,next)=>['owner','manager'].includes(req.user.role)?next():res.sendStatus(403);
const missingProviderTable=e=>e?.code==='42P01'&&/crm_whatsapp_provider_settings/.test(String(e.message||''));
async function selectedProvider(companyId){try{const r=await query('SELECT provider FROM public.crm_whatsapp_provider_settings WHERE company_id=$1',[companyId]);return r.rows[0]?.provider||'evolution'}catch(e){if(missingProviderTable(e))return 'evolution';throw e}}

const secret=()=>process.env.BUILDERBOT_ENCRYPTION_KEY||'';
const key=()=>{if(secret().length<32)throw Object.assign(new Error('BUILDERBOT_ENCRYPTION_KEY missing'),{status:503});return createHash('sha256').update(secret()).digest()};
const hash=s=>createHash('sha256').update(s).digest('hex');
function encrypt(s){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key(),iv),v=Buffer.concat([c.update(s,'utf8'),c.final()]);return [iv.toString('hex'),c.getAuthTag().toString('hex'),v.toString('hex')].join(':')}
function decrypt(s){const [iv,tag,data]=s.split(':'),c=createDecipheriv('aes-256-gcm',key(),Buffer.from(iv,'hex'));c.setAuthTag(Buffer.from(tag,'hex'));return Buffer.concat([c.update(Buffer.from(data,'hex')),c.final()]).toString('utf8')}
async function settings(companyId){const r=await query('SELECT * FROM public.crm_builderbot_settings WHERE company_id=$1',[companyId]);if(!r.rowCount)throw Object.assign(new Error('Sistema IA 2 no está configurado. Guardá primero el ID del bot y la API Key.'),{status:409});return r.rows[0]}
async function remote(cfg,path,method='GET',body){
 const r=await fetch(base+encodeURIComponent(cfg.bot_id)+path,{method,headers:{'x-api-builderbot':decrypt(cfg.api_key_encrypted),'Content-Type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
 const data=await r.json().catch(()=>({}));
 if(!r.ok){const reason=r.status===401||r.status===403?'API Key rechazada o sin permisos':r.status===404?'ID del bot no encontrado o endpoint no disponible':r.status===429?'Límite de solicitudes de la API alcanzado':r.status>=500?'Servicio externo temporalmente no disponible':'Solicitud rechazada por la API';throw Object.assign(new Error('Sistema IA 2: '+reason+' (HTTP '+r.status+')'),{status:502});}
 return data;
}
function err(res,e){return res.status(e.status||500).json({error:e.status?e.message:'No se pudo completar la operación de Sistema IA 2. Revisá la configuración y el registro del servidor.'})}
export function registerBuilderbot(app,auth){
 app.get('/api/whatsapp-provider',auth,wrap(async(req,res)=>{
  let row={rows:[]},migration_required=false;
  try{row=await query('SELECT provider,updated_at FROM public.crm_whatsapp_provider_settings WHERE company_id=$1',[req.user.company_id])}catch(e){if(!missingProviderTable(e))throw e;migration_required=true}
  const bot=await query('SELECT bot_id FROM public.crm_builderbot_settings WHERE company_id=$1',[req.user.company_id]);
  const instances=await query("SELECT count(*)::int AS total FROM public.crm_evolution_instances WHERE company_id=$1 AND status <> 'deleted'",[req.user.company_id]);
  res.json({provider:row.rows[0]?.provider||'evolution',updated_at:row.rows[0]?.updated_at||null,evolution_configured:instances.rows[0].total>0,builderbot_configured:bot.rowCount>0,migration_required});
 }));
 app.put('/api/whatsapp-provider',auth,owner,wrap(async(req,res)=>{
  const provider=req.body?.provider;
  if(!['evolution','builderbot'].includes(provider))return res.status(400).json({error:'Proveedor inválido'});
  if(provider==='builderbot'){
   const cfg=await settings(req.user.company_id);
   try{await remote(cfg,'/settings')}catch(e){return err(res,e)}
  }else{
   const e=await query("SELECT name FROM public.crm_evolution_instances WHERE company_id=$1 AND status <> 'deleted' ORDER BY created_at DESC LIMIT 1",[req.user.company_id]);
   if(!e.rowCount||!process.env.EVOLUTION_API_URL||!process.env.EVOLUTION_API_KEY)return res.status(409).json({error:'Configurá Evolution API antes de activarla'});
   const base=process.env.EVOLUTION_API_URL.replace(/\/$/,'');
   if(!base.startsWith('https://')&&process.env.EVOLUTION_ALLOW_INSECURE_HTTP!=='true')return res.status(409).json({error:'Evolution API requiere HTTPS'});
   try{const response=await fetch(base+'/instance/connectionState/'+encodeURIComponent(e.rows[0].name),{headers:{apikey:process.env.EVOLUTION_API_KEY},signal:AbortSignal.timeout(12000)});const data=await response.json().catch(()=>({}));if(!response.ok||!['open','connected'].includes(String(data.instance?.state||data.state||'').toLowerCase()))return res.status(409).json({error:'Evolution API no tiene una instancia conectada'})}catch{return res.status(502).json({error:'No se pudo verificar Evolution API'})}
  }
  try{await query('INSERT INTO public.crm_whatsapp_provider_settings(company_id,provider) VALUES($1,$2) ON CONFLICT(company_id) DO UPDATE SET provider=EXCLUDED.provider,updated_at=now()',[req.user.company_id,provider])}catch(e){if(missingProviderTable(e))return res.status(503).json({error:'Falta aplicar la migración de WhatsApp. Ejecutá npm run db:migrate en el servidor.'});throw e}
  res.json({provider,ok:true});
 }));
 app.post('/api/conversations/:id/builderbot-send',auth,operator,wrap(async(req,res)=>{
  const selected=await selectedProvider(req.user.company_id);
  if(selected!=='builderbot')return res.status(409).json({error:'Sistema IA 2 no es el proveedor activo'});
  const body=req.body?.body;
  if(typeof body!=='string'||!body.trim()||body.length>4000)return res.status(400).json({error:'Mensaje inválido'});
  const args=[req.params.id,req.user.company_id,...(req.user.role==='agent'?[req.user.id]:[])];
  const c=await query("SELECT c.id,co.phone FROM conversations c JOIN contacts co ON co.id=c.contact_id AND co.company_id=c.company_id WHERE c.id=$1 AND c.company_id=$2 AND c.channel='whatsapp'"+(req.user.role==='agent'?' AND c.assignee_id=$3':''),args);
  if(!c.rowCount)return res.sendStatus(404);
  const number=String(c.rows[0].phone||'').replace(/\D/g,'');
  if(!/^\d{8,15}$/.test(number))return res.status(400).json({error:'Número de contacto inválido'});
  const consent=await query("SELECT opted_in FROM crm_contact_consents WHERE company_id=$1 AND contact_id=(SELECT contact_id FROM conversations WHERE id=$2 AND company_id=$1) AND channel='whatsapp'",[req.user.company_id,req.params.id]);
  if(consent.rows[0]?.opted_in===false)return res.status(409).json({error:'El contacto rechazó recibir mensajes de WhatsApp'});
  try{const cfg=await settings(req.user.company_id);await remote(cfg,'/messages','POST',{number,messages:{content:body.trim()},checkIfExists:true});
   const saved=await query("INSERT INTO messages(conversation_id,sender_id,direction,body) VALUES($1,$2,'outbound',$3) RETURNING *",[req.params.id,req.user.id,body.trim()]);
   await query('UPDATE conversations SET updated_at=now() WHERE id=$1',[req.params.id]);res.status(201).json(saved.rows[0]);
  }catch(e){err(res,e)}
 }));
 app.get('/api/builderbot/settings',auth,owner,wrap(async(req,res)=>{const r=await query('SELECT bot_id,assistant_answer_id,updated_at FROM public.crm_builderbot_settings WHERE company_id=$1',[req.user.company_id]);res.json({configured:!!r.rowCount,secret_ready:secret().length>=32,...r.rows[0]})}));
 app.put('/api/builderbot/settings',auth,owner,wrap(async(req,res)=>{const {bot_id,api_key,assistant_answer_id=null}=req.body||{};
  if(!uuid(bot_id)||typeof api_key!=='string'||api_key.length<20||api_key.length>500||(assistant_answer_id!==null&&!uuid(assistant_answer_id)))return res.sendStatus(400);
  if(secret().length<32)return res.status(503).json({error:'Configure BUILDERBOT_ENCRYPTION_KEY'});
  const token=randomBytes(32).toString('hex');
  await query('INSERT INTO public.crm_builderbot_settings(company_id,bot_id,api_key_encrypted,webhook_token_hash,assistant_answer_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(company_id) DO UPDATE SET bot_id=EXCLUDED.bot_id,api_key_encrypted=EXCLUDED.api_key_encrypted,webhook_token_hash=EXCLUDED.webhook_token_hash,assistant_answer_id=EXCLUDED.assistant_answer_id,updated_at=now()',[req.user.company_id,bot_id,encrypt(api_key),hash(token),assistant_answer_id]);
  res.json({ok:true,webhook_token:token,notice:'Store webhook token now; it will not be shown again'});
 }));
 app.post('/api/builderbot/test',auth,owner,wrap(async(req,res)=>{try{const c=await settings(req.user.company_id);const data=await remote(c,'/settings');res.json({ok:true,settings:data})}catch(e){err(res,e)}}));
 app.get('/api/builderbot/templates',auth,operator,wrap(async(req,res)=>{try{const c=await settings(req.user.company_id);res.json(await remote(c,'/whatsapp-template?limit=100'))}catch(e){err(res,e)}}));
 app.post('/api/builderbot/messages',auth,operator,wrap(async(req,res)=>{const {contact_id,content,media_url}=req.body||{};if(!uuid(contact_id)||typeof content!=='string'||!content.trim()||content.length>4000||(media_url!==undefined&&(!/^https:\/\//.test(media_url)||media_url.length>2000)))return res.sendStatus(400);
  const r=await query('SELECT phone FROM contacts WHERE company_id=$1 AND id=$2',[req.user.company_id,contact_id]);if(!r.rowCount)return res.sendStatus(404);
  const number=String(r.rows[0].phone||'').replace(/\D/g,'');if(!/^\d{8,15}$/.test(number))return res.status(400).json({error:'Invalid contact phone'});
  const consent=await query("SELECT opted_in FROM crm_contact_consents WHERE company_id=$1 AND contact_id=$2 AND channel='whatsapp'",[req.user.company_id,contact_id]);
  if(consent.rows[0]?.opted_in===false)return res.status(409).json({error:'El contacto rechazó recibir mensajes de WhatsApp'});
  try{const c=await settings(req.user.company_id);res.json(await remote(c,'/messages','POST',{number,messages:{content:content.trim(),...(media_url?{mediaUrl:media_url}:{})},checkIfExists:true}))}catch(e){err(res,e)}
 }));
 app.post('/api/builderbot/templates/send',auth,operator,wrap(async(req,res)=>{const {contact_id,template_name,language_code,components=[]}=req.body||{};
  if(!uuid(contact_id)||typeof template_name!=='string'||!/^[\w.-]{1,100}$/.test(template_name)||typeof language_code!=='string'||!/^[a-z]{2}(?:_[A-Z]{2})?$/.test(language_code)||!Array.isArray(components)||JSON.stringify(components).length>8000)return res.sendStatus(400);
  const r=await query('SELECT phone FROM contacts WHERE company_id=$1 AND id=$2',[req.user.company_id,contact_id]);if(!r.rowCount)return res.sendStatus(404);
  const to=String(r.rows[0].phone||'').replace(/\D/g,'');if(!/^\d{8,15}$/.test(to))return res.sendStatus(400);
  const consent=await query("SELECT opted_in FROM crm_contact_consents WHERE company_id=$1 AND contact_id=$2 AND channel='whatsapp'",[req.user.company_id,contact_id]);
  if(consent.rows[0]?.opted_in===false)return res.status(409).json({error:'El contacto rechazó recibir mensajes de WhatsApp'});
  try{const c=await settings(req.user.company_id);res.json(await remote(c,'/whatsapp-template','POST',{to,templateName:template_name,languageCode:language_code,components}))}catch(e){err(res,e)}
 }));
 app.get('/api/builderbot/blacklist',auth,owner,wrap(async(req,res)=>{try{res.json(await remote(await settings(req.user.company_id),'/blacklist'))}catch(e){err(res,e)}}));
 app.post('/api/builderbot/blacklist',auth,owner,wrap(async(req,res)=>{const {number,intent}=req.body||{};if(!/^\d{8,15}$/.test(String(number||''))||!['add','remove'].includes(intent))return res.sendStatus(400);try{res.json(await remote(await settings(req.user.company_id),'/blacklist','POST',{number,intent}))}catch(e){err(res,e)}}));
 app.get('/api/builderbot/assistant',auth,owner,wrap(async(req,res)=>{try{const c=await settings(req.user.company_id);if(!c.assistant_answer_id)return res.status(409).json({error:'Set assistant answer ID first'});res.json(await remote(c,'/answer/'+c.assistant_answer_id+'/plugin/assistant'))}catch(e){err(res,e)}}));
 app.post('/api/builderbot/assistant',auth,owner,wrap(async(req,res)=>{if(typeof req.body?.instructions!=='string'||req.body.instructions.length>20000)return res.sendStatus(400);try{const c=await settings(req.user.company_id);if(!c.assistant_answer_id)return res.sendStatus(409);res.json(await remote(c,'/answer/'+c.assistant_answer_id+'/plugin/assistant','POST',{instructions:req.body.instructions}))}catch(e){err(res,e)}}));
 app.post('/api/builderbot/assistant/files',auth,owner,wrap(async(req,res)=>{const {filename,mime_type,base64}=req.body||{};
  if(typeof filename!=='string'||!/^[\w .()-]{1,100}\.(pdf|txt|md|docx)$/i.test(filename)||typeof base64!=='string'||base64.length>4000000)return res.sendStatus(400);
  const buffer=Buffer.from(base64,'base64');if(!buffer.length||buffer.length>2500000)return res.sendStatus(413);
  try{const c=await settings(req.user.company_id);if(!c.assistant_answer_id)return res.sendStatus(409);
   const form=new FormData();form.append('file',new Blob([buffer],{type:typeof mime_type==='string'?mime_type:'application/octet-stream'}),filename);
   const response=await fetch(base+encodeURIComponent(c.bot_id)+'/answer/'+c.assistant_answer_id+'/plugin/assistant/files',{method:'POST',headers:{'x-api-builderbot':decrypt(c.api_key_encrypted)},body:form,signal:AbortSignal.timeout(20000)});
   const data=await response.json().catch(()=>({}));if(!response.ok)return res.status(502).json({error:'BuilderBot upload failed',upstream_status:response.status});res.json(data);
  }catch(e){err(res,e)}
 }));
 app.get('/api/builderbot/assistant/files',auth,owner,wrap(async(req,res)=>{try{const c=await settings(req.user.company_id);if(!c.assistant_answer_id)return res.sendStatus(409);res.json(await remote(c,'/answer/'+c.assistant_answer_id+'/plugin/assistant/files'))}catch(e){err(res,e)}}));
 app.delete('/api/builderbot/assistant/files/:fileId',auth,owner,wrap(async(req,res)=>{if(!/^[\w-]{1,120}$/.test(req.params.fileId))return res.sendStatus(400);try{const c=await settings(req.user.company_id);if(!c.assistant_answer_id)return res.sendStatus(409);res.json(await remote(c,'/answer/'+c.assistant_answer_id+'/plugin/assistant/files?fileId='+encodeURIComponent(req.params.fileId),'DELETE'))}catch(e){err(res,e)}}));
 app.get('/api/builderbot/webhook-events',auth,owner,wrap(async(req,res)=>{const r=await query('SELECT id,received_at,payload FROM public.crm_builderbot_webhook_events WHERE company_id=$1 ORDER BY id DESC LIMIT 50',[req.user.company_id]);res.json(r.rows)}));

// Normalize only identifiable inbound text events. Unknown provider payloads stay in the event log
// for inspection rather than being assigned to the wrong contact or company.
function inboundEvent(payload){
 const item=payload?.data?.message||payload?.data||payload?.message||payload;
 if(!item||typeof item!=='object'||Array.isArray(item))return null;
 const fromMe=item.fromMe??item.from_me??item.key?.fromMe??payload.fromMe;
 if(fromMe===true||fromMe==='true'||item.direction==='outbound'||item.type==='outgoing')return null;
 const rawPhone=item.key?.remoteJid||item.from||item.phone||item.number||item.sender?.phone||item.sender?.id||item.contact?.phone;
 if(typeof rawPhone!=='string')return null;
 const phone=rawPhone.replace(/@s\.whatsapp\.net$/,'').replace(/[^0-9]/g,'');
 if(!/^\d{8,15}$/.test(phone))return null;
 const rawBody=item.body??item.text??item.content??item.message?.conversation??item.message?.extendedTextMessage?.text??item.message?.text;
 const body=typeof rawBody==='string'?rawBody.trim():typeof rawBody?.text==='string'?rawBody.text.trim():'';
 if(!body||body.length>10000)return null;
 const id=item.key?.id||item.messageId||item.message_id||item.id||payload.eventId;
 if(typeof id!=='string'||id.length<3||id.length>250)return null;
 return {phone,body,id,name:String(item.pushName||item.sender?.name||phone).slice(0,200)};
}
async function syncInbound(companyId,botId,payload){
 const event=inboundEvent(payload);
 if(!event)return false;
 const external='sistema-ia2:'+botId+':'+event.id;
 const existing=await query('SELECT id FROM messages WHERE external_id=$1',[external]);
 if(existing.rowCount)return false;
 let contact=await query('SELECT id FROM contacts WHERE company_id=$1 AND phone=$2 LIMIT 1',[companyId,event.phone]);
 if(!contact.rowCount)contact=await query("INSERT INTO contacts(company_id,name,phone,source) VALUES($1,$2,$3,'whatsapp') RETURNING id",[companyId,event.name,event.phone]);
 let conversation=await query("SELECT id FROM conversations WHERE company_id=$1 AND channel='whatsapp' AND external_id=$2 LIMIT 1",[companyId,event.phone]);
 if(!conversation.rowCount)conversation=await query("INSERT INTO conversations(company_id,contact_id,channel,external_id) VALUES($1,$2,'whatsapp',$3) RETURNING id",[companyId,contact.rows[0].id,event.phone]);
 const saved=await query("INSERT INTO messages(conversation_id,direction,body,external_id) VALUES($1,'inbound',$2,$3) ON CONFLICT DO NOTHING RETURNING id",[conversation.rows[0].id,event.body,external]);
 if(saved.rowCount)await query('UPDATE conversations SET unread_count=unread_count+1,updated_at=now() WHERE id=$1',[conversation.rows[0].id]);
 return Boolean(saved.rowCount);
}
 // BuilderBot custom webhook header must be configured to X-Zarco-Webhook-Token.
 app.post('/api/webhooks/builderbot/:botId',wrap(async(req,res)=>{
  if(!uuid(req.params.botId))return res.sendStatus(404);
  const token=req.headers['x-zarco-webhook-token'];if(typeof token!=='string'||token.length!==64)return res.sendStatus(401);
  const rows=await query('SELECT company_id,webhook_token_hash FROM public.crm_builderbot_settings WHERE bot_id=$1',[req.params.botId]);
  const digest=hash(token);const cfg=rows.rows.find(c=>timingSafeEqual(Buffer.from(c.webhook_token_hash),Buffer.from(digest)));
  if(!cfg)return res.sendStatus(401);
  const payload=req.body;if(!payload||typeof payload!=='object'||Array.isArray(payload))return res.sendStatus(400);
  const serialized=JSON.stringify(payload);if(serialized.length>900000)return res.sendStatus(413);
  const eventHash=hash(serialized);
  await query('INSERT INTO public.crm_builderbot_webhook_events(company_id,bot_id,event_hash,payload) VALUES($1,$2,$3,$4) ON CONFLICT(company_id,event_hash) DO NOTHING',[cfg.company_id,req.params.botId,eventHash,serialized]);
  const synced=await syncInbound(cfg.company_id,req.params.botId,payload);
  res.status(202).json({received:true,synced});
 }));
}
