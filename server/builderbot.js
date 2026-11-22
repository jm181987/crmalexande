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

// BuilderBot document proxy: stored bytes are served only to authorized CRM users.
const mediaHosts=()=>String(process.env.BUILDERBOT_MEDIA_ALLOWED_HOSTS||'app.builderbot.cloud').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean);
async function fetchInboundDocument(url){
 const u=new URL(url);
 if(u.protocol!=='https:'||u.username||u.password||u.port||!mediaHosts().some(host=>u.hostname.toLowerCase()===host||u.hostname.toLowerCase().endsWith('.'+host)))throw Error('Untrusted media host');
 const response=await fetch(u,{redirect:'error',signal:AbortSignal.timeout(12000),headers:{Accept:'application/pdf,application/octet-stream;q=0.9'}});
 if(!response.ok)throw Error('Media download HTTP '+response.status);
 const declared=Number(response.headers.get('content-length')||0);
 if(declared>8*1024*1024)throw Error('Document exceeds 8 MB');
 const chunks=[];let size=0;
 for await(const chunk of response.body){size+=chunk.length;if(size>8*1024*1024)throw Error('Document exceeds 8 MB');chunks.push(chunk)}
 const content=Buffer.concat(chunks);
 if(content.subarray(0,5).toString()!=='%PDF-')throw Error('Downloaded file is not a PDF');
 return content;
}
export function registerBuilderbot(app,auth){
 app.get('/api/conversations/:id/builderbot-document/:mediaId',auth,wrap(async(req,res)=>{
  if(!uuid(req.params.id)||!uuid(req.params.mediaId))return res.sendStatus(404);
  const args=[req.params.mediaId,req.params.id,req.user.company_id,...(req.user.role==='agent'?[req.user.id]:[])];
  const media=await query("SELECT m.content,m.mime,m.filename FROM public.crm_chat_media m JOIN public.conversations c ON c.id=m.conversation_id AND c.company_id=m.company_id WHERE m.id=$1 AND m.conversation_id=$2 AND m.company_id=$3"+(req.user.role==='agent'?' AND c.assignee_id=$4':''),args);
  if(!media.rowCount)return res.sendStatus(404);
  const file=media.rows[0];
  res.set({'Content-Type':'application/pdf','Content-Disposition':'inline; filename="document.pdf"','X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store'});
  res.send(file.content);
 }));
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
 app.post('/api/builderbot/webhook-token/rotate',auth,owner,wrap(async(req,res)=>{
  const token=randomBytes(32).toString('hex');
  const updated=await query('UPDATE public.crm_builderbot_settings SET webhook_token_hash=$1,updated_at=now() WHERE company_id=$2 RETURNING bot_id',[hash(token),req.user.company_id]);
  if(!updated.rowCount)return res.status(409).json({error:'Configurá primero Sistema IA 2'});
  res.set('Cache-Control','no-store');
  res.json({ok:true,bot_id:updated.rows[0].bot_id,webhook_token:token,webhook_url:'/api/webhooks/builderbot/'+updated.rows[0].bot_id+'?token='+token,notice:'El token anterior quedó invalidado. Configurá el header o la URL secreta del webhook. No compartas la URL.'});
 }));
 app.get('/api/builderbot/settings',auth,owner,wrap(async(req,res)=>{const r=await query('SELECT bot_id,assistant_answer_id,updated_at FROM public.crm_builderbot_settings WHERE company_id=$1',[req.user.company_id]);res.json({configured:!!r.rowCount,secret_ready:secret().length>=32,...r.rows[0]})}));
 app.put('/api/builderbot/settings',auth,owner,wrap(async(req,res)=>{const {bot_id,api_key,assistant_answer_id=null}=req.body||{};
  if(!uuid(bot_id)||typeof api_key!=='string'||api_key.length<20||api_key.length>500||(assistant_answer_id!==null&&!uuid(assistant_answer_id)))return res.sendStatus(400);
  if(secret().length<32)return res.status(503).json({error:'Configure BUILDERBOT_ENCRYPTION_KEY'});
  const token=randomBytes(32).toString('hex');
  await query('INSERT INTO public.crm_builderbot_settings(company_id,bot_id,api_key_encrypted,webhook_token_hash,assistant_answer_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(company_id) DO UPDATE SET bot_id=EXCLUDED.bot_id,api_key_encrypted=EXCLUDED.api_key_encrypted,webhook_token_hash=EXCLUDED.webhook_token_hash,assistant_answer_id=EXCLUDED.assistant_answer_id,updated_at=now()',[req.user.company_id,bot_id,encrypt(api_key),hash(token),assistant_answer_id]);
  res.json({ok:true,webhook_token:token,webhook_url:'/api/webhooks/builderbot/'+bot_id+'?token='+token,notice:'Guardá el token o la URL secreta: no se volverán a mostrar'});
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
 // Resolve the WhatsApp number from the contact or conversation JID.
 // Never use @lid identifiers or arbitrary long digit strings as phone numbers.
 const contactPhone=(row)=>{
  const candidates=[row.phone,row.external_id].filter(v=>typeof v==='string');
  for(const raw of candidates){
   const value=raw.trim();
   if(/@lid(?:$|\b)/i.test(value))continue;
   const local=value.replace(/@(?:s\.whatsapp\.net|c\.us)$/i,'');
   if(!/^\+?[\d\s().-]+$/.test(local))continue;
   const digits=local.replace(/\D/g,'');
   if(/^\d{8,15}$/.test(digits))return digits;
  }
  return null;
 };
 // Human takeover: BuilderBot's per-number blacklist stops bot replies,
 // while Evolution continues to receive and send WhatsApp messages.
 app.get('/api/conversations/:id/builderbot-ai',auth,operator,wrap(async(req,res)=>{
  if(!uuid(req.params.id))return res.sendStatus(400);
  const c=await query("SELECT co.phone,c.external_id FROM public.conversations c JOIN public.contacts co ON co.id=c.contact_id AND co.company_id=c.company_id WHERE c.id=$1 AND c.company_id=$2 AND c.channel='whatsapp'",[req.params.id,req.user.company_id]);
  if(!c.rowCount)return res.sendStatus(404);
  const number=contactPhone(c.rows[0]);
  if(!number)return res.json({paused:null,updated_at:null,remote_control_enabled:false,error:'No se identificó un número WhatsApp válido para este contacto',provider:'builderbot',chat_provider:'evolution'});
  const state=await query('SELECT paused,updated_at FROM public.crm_builderbot_contact_ai WHERE company_id=$1 AND phone=$2',[req.user.company_id,number]);
  res.json({paused:state.rows[0]?.paused??null,updated_at:state.rows[0]?.updated_at??null,remote_control_enabled:true,method:'blacklist',provider:'builderbot',chat_provider:'evolution'});
 }));
 app.put('/api/conversations/:id/builderbot-ai',auth,operator,wrap(async(req,res)=>{
  if(!uuid(req.params.id)||typeof req.body?.paused!=='boolean')return res.sendStatus(400);
  const c=await query("SELECT co.phone,c.external_id FROM public.conversations c JOIN public.contacts co ON co.id=c.contact_id AND co.company_id=c.company_id WHERE c.id=$1 AND c.company_id=$2 AND c.channel='whatsapp'",[req.params.id,req.user.company_id]);
  if(!c.rowCount)return res.sendStatus(404);
  const number=contactPhone(c.rows[0]);
  if(!number)return res.status(409).json({error:'No se pudo identificar un número WhatsApp válido para BuilderBot. Revisá el teléfono del contacto.'});
  try{
   const cfg=await settings(req.user.company_id);
   await remote(cfg,'/blacklist','POST',{number,intent:req.body.paused?'add':'remove'});
  }catch(e){return err(res,e)}
  const result=await query('INSERT INTO public.crm_builderbot_contact_ai(company_id,phone,paused,updated_by) VALUES($1,$2,$3,$4) ON CONFLICT(company_id,phone) DO UPDATE SET paused=EXCLUDED.paused,updated_by=EXCLUDED.updated_by,updated_at=now() RETURNING paused,updated_at',[req.user.company_id,number,req.body.paused,req.user.id]);
  res.json({ok:true,...result.rows[0],method:'blacklist',provider:'builderbot',chat_provider:'evolution'});
 }));
 app.get('/api/builderbot/webhook-events',auth,owner,wrap(async(req,res)=>{const r=await query('SELECT id,received_at,payload FROM public.crm_builderbot_webhook_events WHERE company_id=$1 ORDER BY id DESC LIMIT 50',[req.user.company_id]);res.json(r.rows)}));

}

// Accept both documented message.incoming/message.outgoing events and the
// CUSTOMER/AGENT payloads emitted by the provider. Never infer a contact from
// an unrecognized payload; raw events remain available for diagnostics.
function normalizeWebhookMessage(payload,eventHash){
 const data=payload?.data;
 const item=(data?.message&&typeof data.message==='object'?data.message:null)||
   (data&&typeof data==='object'&&!Array.isArray(data)?data:null)||
   (payload?.message&&typeof payload.message==='object'?payload.message:null)||payload;
 if(!item||typeof item!=='object'||Array.isArray(item))return null;
 const eventType=String(payload.eventName||payload.event||payload.type||payload.eventType||'').toLowerCase();
 const sender=String(item.sender?.type||item.sender||payload.sender||'').toUpperCase();
 const origin=String(item.origin||payload.origin||'').toUpperCase();
 const fromMe=item.fromMe??item.from_me??item.key?.fromMe??payload.fromMe;
 const outgoing=eventType==='message.outgoing'||eventType==='outgoing'||
   sender==='AGENT'||origin==='BOT'||origin==='CRM_AGENT'||fromMe===true||fromMe==='true'||
   item.direction==='outbound'||item.type==='outgoing';
 const incoming=eventType==='message.incoming'||eventType==='incoming'||sender==='CUSTOMER'||
   fromMe===false||fromMe==='false'||item.direction==='inbound';
 if(!outgoing&&!incoming)return null;
 const rawPhone=item.key?.remoteJid||item.phone||item.from||item.number||
   item.sender?.phone||item.sender?.id||item.contact?.phone||payload.phone;
 if(typeof rawPhone!=='string'&&typeof rawPhone!=='number')return null;
 const phone=String(rawPhone).replace(/@s\.whatsapp\.net$/,'').replace(/[^0-9]/g,'');
 if(!/^\d{8,15}$/.test(phone))return null;
 const rawBody=item.body??item.answer??item.text??item.content??(typeof item.message==='string'?item.message:undefined)??
   item.message?.conversation??item.message?.extendedTextMessage?.text??item.message?.text;
 let body=typeof rawBody==='string'?rawBody.trim():typeof rawBody?.text==='string'?rawBody.text.trim():'';
 // Preserve incoming media-only messages. Use the same CRM_MEDIA marker consumed by
 // ChatMediaPreview for images, video and audio; documents follow that same path.
 const candidates=[item.message?.documentMessage,item.message?.imageMessage,item.message?.videoMessage,item.message?.audioMessage,item.document,item.media,item.attachment,item.file,item.attachments?.[0],item.mediaUrl,item.media_url,item.fileUrl,item.file_url,item.url,payload.media,payload.attachment,payload.document,payload.mediaUrl];
 let attachment=null;
 for(const candidate of candidates){
  if(!candidate)continue;
  const obj=typeof candidate==='string'?{url:candidate}:candidate;
  if(!obj||typeof obj!=='object')continue;
  const url=obj.url||obj.mediaUrl||obj.media_url||obj.fileUrl||obj.file_url||obj.downloadUrl||obj.download_url;
  if(typeof url!=='string'||url.length>2000||!/^https:\/\/[^\s<>\[\]]+$/i.test(url))continue;
  const mime=String(obj.mimetype||obj.mimeType||obj.mime_type||obj.type||item.mimetype||item.mimeType||'').toLowerCase();
  const filename=String(obj.fileName||obj.filename||obj.name||item.fileName||item.filename||'').replace(/[\[\]\r\n]/g,'').slice(0,160);
  const path=(()=>{try{return new URL(url).pathname.toLowerCase()}catch{return ''}})();
  const kind=mime.includes('pdf')||mime.includes('document')||mime.includes('text/')||/\.(pdf|txt|docx?|xlsx?)$/.test(path)||/\.(pdf|txt|docx?|xlsx?)$/i.test(filename)?'document':mime.startsWith('image/')||/\.(png|jpe?g|webp|gif)$/.test(path)?'image':mime.startsWith('video/')||/\.(mp4|webm|mov)$/.test(path)?'video':mime.startsWith('audio/')||/\.(mp3|ogg|opus|wav|m4a)$/.test(path)?'audio':null;
  if(kind){attachment={kind,url,filename:filename||(kind==='document'?'Documento':'Archivo multimedia')};break}
 }
 if(attachment&&!body.includes('[CRM_MEDIA:'))body=(body?body+'\n':'')+'[CRM_MEDIA:'+attachment.kind+':'+attachment.url+':'+attachment.filename+']';
 if(!body||body.length>10000)return null;
 const rawId=item.key?.id||item.messageId||item.message_id||item.id||payload.eventId;
 const id=typeof rawId==='string'&&rawId.length>=3&&rawId.length<=250?rawId:eventHash;
 const direction=outgoing?'outbound':'inbound';
 const name=String(item.pushName||item.name||item.contact?.name||item.sender?.name||phone).slice(0,200);
 return {phone,body,id,direction,name};
}
async function syncWebhookMessage(companyId,botId,payload,eventHash){
 const event=normalizeWebhookMessage(payload,eventHash);
 if(!event)return false;
 const external='sistema-ia2:'+botId+':'+event.id;
 const existing=await query('SELECT id FROM messages WHERE external_id=$1',[external]);
 if(existing.rowCount)return false;
 let contact=await query('SELECT id FROM contacts WHERE company_id=$1 AND phone=$2 LIMIT 1',[companyId,event.phone]);
 if(!contact.rowCount)contact=await query("INSERT INTO contacts(company_id,name,phone,source) VALUES($1,$2,$3,'whatsapp') RETURNING id",[companyId,event.name,event.phone]);
 let conversation=await query("SELECT id FROM conversations WHERE company_id=$1 AND channel='whatsapp' AND (external_id=$2 OR contact_id=$3) LIMIT 1",[companyId,event.phone,contact.rows[0].id]);
 if(!conversation.rowCount)conversation=await query("INSERT INTO conversations(company_id,contact_id,channel,external_id) VALUES($1,$2,'whatsapp',$3) RETURNING id",[companyId,contact.rows[0].id,event.phone]);
 let messageBody=event.body;
 // Persist incoming PDFs before inserting the message. Never store expiring provider URLs as the only reference.
 if(event.direction==='inbound'){
  const match=messageBody.match(/\[CRM_MEDIA:document:(https:\/\/[^\s\]]+):([^\]]+)\]/);
  if(match&&/\.pdf$/i.test(match[2])){
   try{
    const bytes=await fetchInboundDocument(match[1]);
    const stored=await query("INSERT INTO public.crm_chat_media(company_id,conversation_id,mime,filename,content,status,size_bytes) VALUES($1,$2,'application/pdf',$3,$4,'ready',$5) RETURNING id",[companyId,conversation.rows[0].id,match[2],bytes,bytes.length]);
    messageBody=messageBody.replace(match[0],'[CRM_MEDIA:document:/api/conversations/'+conversation.rows[0].id+'/builderbot-document/'+stored.rows[0].id+':'+match[2]+']');
   }catch(e){console.warn('[Sistema IA 2 document] download skipped:',String(e.message||e).slice(0,140))}
  }
 }
 const saved=await query("INSERT INTO messages(conversation_id,direction,body,external_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id",[conversation.rows[0].id,event.direction,messageBody,external]);
 if(saved.rowCount){
  if(event.direction==='inbound')await query('UPDATE conversations SET unread_count=COALESCE(unread_count,0)+1,updated_at=now() WHERE id=$1',[conversation.rows[0].id]);
  else await query('UPDATE conversations SET updated_at=now() WHERE id=$1',[conversation.rows[0].id]);
 }
 return Boolean(saved.rowCount);
}

// Register this unauthenticated, token-protected endpoint before session routes.
export function registerBuilderbotWebhook(app){
 app.get('/api/webhooks/builderbot/:botId',(req,res)=>res.status(405).set('Allow','POST').json({error:'Webhook accepts POST only',code:'WEBHOOK_POST_ONLY'}));
 // BuilderBot custom webhook header must be configured to X-Zarco-Webhook-Token.
 app.post('/api/webhooks/builderbot/:botId',wrap(async(req,res)=>{
  if(!uuid(req.params.botId)){console.warn('[Sistema IA 2 webhook] invalid bot ID');return res.sendStatus(404);}
  const headerToken=req.headers['x-zarco-webhook-token'];
  const urlToken=req.query?.token;
  // Providers without custom-header support may send the same secret in the HTTPS URL.
  // Never log either credential or the complete request URL.
  const token=typeof headerToken==='string'&&headerToken.length===64?headerToken:urlToken;
  if(typeof token!=='string'||!/^[a-f0-9]{64}$/i.test(token)){console.warn('[Sistema IA 2 webhook] missing or invalid token format');return res.sendStatus(401);}
  const rows=await query('SELECT company_id,webhook_token_hash FROM public.crm_builderbot_settings WHERE bot_id=$1',[req.params.botId]);
  const digest=hash(token);const cfg=rows.rows.find(c=>typeof c.webhook_token_hash==='string'&&c.webhook_token_hash.length===64&&timingSafeEqual(Buffer.from(c.webhook_token_hash),Buffer.from(digest)));
  if(!cfg){console.warn('[Sistema IA 2 webhook] token mismatch or unknown bot');return res.sendStatus(401);}
  const payload=req.body;if(!payload||typeof payload!=='object'||Array.isArray(payload))return res.sendStatus(400);
  const serialized=JSON.stringify(payload);if(serialized.length>900000)return res.sendStatus(413);
  const eventHash=hash(serialized);
  await query('INSERT INTO public.crm_builderbot_webhook_events(company_id,bot_id,event_hash,payload) VALUES($1,$2,$3,$4) ON CONFLICT(company_id,event_hash) DO NOTHING',[cfg.company_id,req.params.botId,eventHash,serialized]);
  const synced=await syncWebhookMessage(cfg.company_id,req.params.botId,payload,eventHash);
  console.info('[Sistema IA 2 webhook] accepted', {synced, event:String(payload.eventName||payload.event||payload.type||'unknown').slice(0,60)});
  res.status(202).json({received:true,synced});
 }));

}
