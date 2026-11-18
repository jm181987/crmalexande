import {createCipheriv,createDecipheriv,createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {query} from './db.js';
const base='https://app.builderbot.cloud/api/v2/';
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const uuid=s=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const owner=(req,res,next)=>req.user.role==='owner'?next():res.sendStatus(403);
const operator=(req,res,next)=>['owner','manager'].includes(req.user.role)?next():res.sendStatus(403);
const secret=()=>process.env.BUILDERBOT_ENCRYPTION_KEY||'';
const key=()=>{if(secret().length<32)throw Object.assign(new Error('BUILDERBOT_ENCRYPTION_KEY missing'),{status:503});return createHash('sha256').update(secret()).digest()};
const hash=s=>createHash('sha256').update(s).digest('hex');
function encrypt(s){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key(),iv),v=Buffer.concat([c.update(s,'utf8'),c.final()]);return [iv.toString('hex'),c.getAuthTag().toString('hex'),v.toString('hex')].join(':')}
function decrypt(s){const [iv,tag,data]=s.split(':'),c=createDecipheriv('aes-256-gcm',key(),Buffer.from(iv,'hex'));c.setAuthTag(Buffer.from(tag,'hex'));return Buffer.concat([c.update(Buffer.from(data,'hex')),c.final()]).toString('utf8')}
async function settings(companyId){const r=await query('SELECT * FROM public.crm_builderbot_settings WHERE company_id=$1',[companyId]);if(!r.rowCount)throw Object.assign(new Error('BuilderBot not configured'),{status:409});return r.rows[0]}
async function remote(cfg,path,method='GET',body){
 const r=await fetch(base+encodeURIComponent(cfg.bot_id)+path,{method,headers:{'x-api-builderbot':decrypt(cfg.api_key_encrypted),'Content-Type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
 const data=await r.json().catch(()=>({}));
 if(!r.ok)throw Object.assign(new Error('BuilderBot upstream HTTP '+r.status),{status:502});
 return data;
}
function err(res,e){return res.status(e.status||500).json({error:e.status?e.message:'BuilderBot operation failed'})}
export function registerBuilderbot(app,auth){
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
  if(!consent.rows[0]?.opted_in)return res.status(409).json({error:'WhatsApp contact has no active opt-in'});
  try{const c=await settings(req.user.company_id);res.json(await remote(c,'/messages','POST',{number,messages:{content:content.trim(),...(media_url?{mediaUrl:media_url}:{})},checkIfExists:true}))}catch(e){err(res,e)}
 }));
 app.post('/api/builderbot/templates/send',auth,operator,wrap(async(req,res)=>{const {contact_id,template_name,language_code,components=[]}=req.body||{};
  if(!uuid(contact_id)||typeof template_name!=='string'||!/^[\w.-]{1,100}$/.test(template_name)||typeof language_code!=='string'||!/^[a-z]{2}(?:_[A-Z]{2})?$/.test(language_code)||!Array.isArray(components)||JSON.stringify(components).length>8000)return res.sendStatus(400);
  const r=await query('SELECT phone FROM contacts WHERE company_id=$1 AND id=$2',[req.user.company_id,contact_id]);if(!r.rowCount)return res.sendStatus(404);
  const to=String(r.rows[0].phone||'').replace(/\D/g,'');if(!/^\d{8,15}$/.test(to))return res.sendStatus(400);
  const consent=await query("SELECT opted_in FROM crm_contact_consents WHERE company_id=$1 AND contact_id=$2 AND channel='whatsapp'",[req.user.company_id,contact_id]);
  if(!consent.rows[0]?.opted_in)return res.status(409).json({error:'WhatsApp contact has no active opt-in'});
  try{const c=await settings(req.user.company_id);res.json(await remote(c,'/whatsapp-template','POST',{to,templateName:template_name,languageCode:language_code,components}))}catch(e){err(res,e)}
 }));
 app.get('/api/builderbot/blacklist',auth,owner,wrap(async(req,res)=>{try{res.json(await remote(await settings(req.user.company_id),'/blacklist'))}catch(e){err(res,e)}}));
 app.post('/api/builderbot/blacklist',auth,owner,wrap(async(req,res)=>{const {number,intent}=req.body||{};if(!/^\d{8,15}$/.test(String(number||''))||!['add','remove'].includes(intent))return res.sendStatus(400);try{res.json(await remote(await settings(req.user.company_id),'/blacklist','POST',{number,intent}))}catch(e){err(res,e)}}));
 app.get('/api/builderbot/assistant',auth,owner,wrap(async(req,res)=>{try{const c=await settings(req.user.company_id);if(!c.assistant_answer_id)return res.status(409).json({error:'Set assistant answer ID first'});res.json(await remote(c,'/answer/'+c.assistant_answer_id+'/plugin/assistant'))}catch(e){err(res,e)}}));
 app.post('/api/builderbot/assistant',auth,owner,wrap(async(req,res)=>{if(typeof req.body?.instructions!=='string'||req.body.instructions.length>20000)return res.sendStatus(400);try{const c=await settings(req.user.company_id);if(!c.assistant_answer_id)return res.sendStatus(409);res.json(await remote(c,'/answer/'+c.assistant_answer_id+'/plugin/assistant','POST',{instructions:req.body.instructions}))}catch(e){err(res,e)}}));
 app.post('/api/builderbot/assistant/files',auth,owner,wrap(async(req,res)=>{const {filename,mime_type,base64}=req.body||{};
  if(typeof filename!=='string'||!/^[\\w .()-]{1,100}\\.(pdf|txt|md|docx)$/i.test(filename)||typeof base64!=='string'||base64.length>4000000)return res.sendStatus(400);
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
  res.status(202).json({received:true});
 }));
}
