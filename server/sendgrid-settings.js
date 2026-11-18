import {createCipheriv,createDecipheriv,randomBytes,createHash} from 'node:crypto';
import {query} from './db.js';
const secret=()=>process.env.SENDGRID_SETTINGS_ENCRYPTION_KEY||'';
const key=()=>{if(secret().length<32)throw Error('SENDGRID_SETTINGS_ENCRYPTION_KEY must be at least 32 characters');return createHash('sha256').update(secret()).digest()};
const email=s=>typeof s==='string'&&s.length<=254&&/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(s);
export function encryptKey(value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);const data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return [iv.toString('hex'),cipher.getAuthTag().toString('hex'),data.toString('hex')].join(':')}
export function decryptKey(value){const [iv,tag,data]=value.split(':');const decipher=createDecipheriv('aes-256-gcm',key(),Buffer.from(iv,'hex'));decipher.setAuthTag(Buffer.from(tag,'hex'));return Buffer.concat([decipher.update(Buffer.from(data,'hex')),decipher.final()]).toString('utf8')}
export async function sendgridForCompany(companyId){
 const x=await query('SELECT api_key_ciphertext,from_email,reply_to FROM public.crm_sendgrid_settings WHERE company_id=$1',[companyId]);
 if(x.rowCount)return {apiKey:decryptKey(x.rows[0].api_key_ciphertext),from:x.rows[0].from_email,replyTo:x.rows[0].reply_to};
 return {apiKey:process.env.SENDGRID_API_KEY||'',from:process.env.SENDGRID_FROM_EMAIL||'',replyTo:process.env.SENDGRID_REPLY_TO||''};
}
export function registerSendgridSettings(app,auth){
 const owner=(req,res,next)=>req.user.role==='owner'?next():res.sendStatus(403);
 const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
 app.get('/api/settings/sendgrid',auth,owner,wrap(async(req,res)=>{
  const x=await query('SELECT from_email,reply_to FROM public.crm_sendgrid_settings WHERE company_id=$1',[req.user.company_id]);
  res.json({configured:!!x.rowCount||!!process.env.SENDGRID_API_KEY,from_email:x.rows[0]?.from_email||process.env.SENDGRID_FROM_EMAIL||'',reply_to:x.rows[0]?.reply_to||process.env.SENDGRID_REPLY_TO||'',key_stored:!!x.rowCount,secret_ready:secret().length>=32});
 }));
 app.put('/api/settings/sendgrid',auth,owner,wrap(async(req,res)=>{
  const {api_key,from_email,reply_to=''}=req.body||{};
  if(secret().length<32)return res.status(503).json({error:'Configure SENDGRID_SETTINGS_ENCRYPTION_KEY on the server first'});
  if(typeof api_key!=='string'||!/^SG\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}$/.test(api_key)||!email(from_email)||(reply_to&&!email(reply_to)))return res.status(400).json({error:'Invalid SendGrid API key or sender email'});
  await query('INSERT INTO public.crm_sendgrid_settings(company_id,api_key_ciphertext,from_email,reply_to) VALUES($1,$2,$3,$4) ON CONFLICT(company_id) DO UPDATE SET api_key_ciphertext=EXCLUDED.api_key_ciphertext,from_email=EXCLUDED.from_email,reply_to=EXCLUDED.reply_to,updated_at=now()',[req.user.company_id,encryptKey(api_key),from_email,reply_to||null]);
  res.json({ok:true});
 }));
}
