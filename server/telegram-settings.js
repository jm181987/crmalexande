import {query} from './db.js';

export const TELEGRAM_EVENTS=['new_opportunity','security_access','new_contact'];
const DEFAULT_EVENTS=['new_opportunity','security_access','new_contact'];
const chatId=()=>String(process.env.TELEGRAM_CHAT_ID||'918080020').trim();
const token=()=>String(process.env.TELEGRAM_BOT_TOKEN||'').trim();
const safe=(value,max=160)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,max);
const isMissingTable=e=>e?.code==='42P01';
async function preferences(companyId){
 try{
  const r=await query('SELECT enabled,events FROM public.crm_telegram_settings WHERE company_id=$1',[companyId]);
  return r.rows[0]||{enabled:true,events:DEFAULT_EVENTS};
 }catch(e){if(isMissingTable(e))return {enabled:false,events:DEFAULT_EVENTS,migration_required:true};throw e}
}
async function deliver(message){
 if(!token()||!/^\d{5,20}$/.test(chatId()))return {ok:false,error:'Configure TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in Coolify'};
 let response;
 try{response=await fetch('https://api.telegram.org/bot'+token()+'/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chatId(),text:message,disable_web_page_preview:true}),signal:AbortSignal.timeout(10000)})}
 catch{return {ok:false,error:'Telegram connection failed'}}
 if(!response.ok)return {ok:false,error:'Telegram rejected the message',provider_status:response.status};
 return {ok:true};
}
export async function notifyTelegram(companyId,event,details){
 if(!TELEGRAM_EVENTS.includes(event)||!companyId)return;
 try{
  const pref=await preferences(companyId);
  if(!pref.enabled||!pref.events.includes(event))return;
  const title={new_opportunity:'Nueva oportunidad comercial',security_access:'Alerta de seguridad y accesos',new_contact:'Nuevo contacto registrado'}[event];
  const message='🔔 ZARKO CRM | '+title+'\n'+safe(details,700)+'\n'+new Date().toISOString();
  const result=await deliver(message);
  if(!result.ok)console.warn('Telegram notification not delivered:',result.error,result.provider_status||'');
 }catch(e){console.warn('Telegram notification error:',e.code||e.message)}
}
export function registerTelegramSettings(app,auth){
 const owner=(req,res,next)=>req.user.role==='owner'&&!req.user.support_mode?next():res.sendStatus(403);
 const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
 app.get('/api/settings/telegram',auth,owner,wrap(async(req,res)=>{
  const pref=await preferences(req.user.company_id);
  res.json({enabled:pref.enabled,events:pref.events,bot_configured:!!token(),chat_configured:/^\d{5,20}$/.test(chatId()),chat_id_masked:chatId().replace(/.(?=.{4})/g,'•'),migration_required:!!pref.migration_required});
 }));
 app.put('/api/settings/telegram',auth,owner,wrap(async(req,res)=>{
  const {enabled,events}=req.body||{};
  if(typeof enabled!=='boolean'||!Array.isArray(events)||events.some(e=>!TELEGRAM_EVENTS.includes(e))||new Set(events).size!==events.length)return res.status(400).json({error:'Invalid Telegram preferences'});
  try{
   await query('INSERT INTO public.crm_telegram_settings(company_id,enabled,events) VALUES($1,$2,$3) ON CONFLICT(company_id) DO UPDATE SET enabled=EXCLUDED.enabled,events=EXCLUDED.events,updated_at=now()',[req.user.company_id,enabled,events]);
  }catch(e){if(isMissingTable(e))return res.status(503).json({error:'Run database migration before saving Telegram settings'});throw e}
  res.json({ok:true});
 }));
 app.post('/api/settings/telegram/test',auth,owner,wrap(async(req,res)=>{
  if(!token())return res.status(503).json({error:'TELEGRAM_BOT_TOKEN is not configured in Coolify'});
  const result=await deliver('✅ ZARKO CRM | Prueba de Telegram\nEnviada por un owner autorizado.\n'+new Date().toISOString());
  if(!result.ok)return res.status(502).json({error:result.error,provider_status:result.provider_status});
  res.json({ok:true,message:'Telegram aceptó el mensaje de prueba. Revisá el chat de destino.'});
 }));
}
