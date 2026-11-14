import express from 'express';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {query} from './db.js';
const key=()=>process.env.CAMPAIGN_UNSUBSCRIBE_SECRET||'';
const sign=(value)=>createHmac('sha256',key()).update(value).digest('hex');
export function unsubscribeUrl(companyId,contactId){
 if(key().length<32||!/^https:\/\//.test(process.env.PUBLIC_APP_URL||''))throw Error('unsubscribe_not_configured');
 const token=companyId+'.'+contactId;
 return process.env.PUBLIC_APP_URL.replace(/\/$/,'')+'/api/campaigns/unsubscribe?token='+encodeURIComponent(token+'.'+sign(token));
}
export function registerUnsubscribe(app){
 const validate=token=>{
  if(key().length<32||typeof token!=='string'||token.length>250)return null;
  const parts=token.split('.');
  if(parts.length!==3||!parts.slice(0,2).every(x=>/^[0-9a-f-]{36}$/i.test(x))||!/^[0-9a-f]{64}$/.test(parts[2]))return null;
  const expected=sign(parts[0]+'.'+parts[1]);
  if(!timingSafeEqual(Buffer.from(expected),Buffer.from(parts[2])))return null;
  return {company:parts[0],contact:parts[1]};
 };
 const html=(message,form='')=>'<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:system-ui;max-width:550px;margin:60px auto;padding:20px"><h1>Preferencias de correo</h1><p>'+message+'</p>'+form+'</body></html>';
 app.get('/api/campaigns/unsubscribe',(req,res)=>{
  const token=String(req.query.token||'');
  if(!validate(token))return res.status(400).type('html').send(html('Enlace inválido.'));
  res.type('html').send(html('Confirmá si querés dejar de recibir correos comerciales.','<form method="POST" action="/api/campaigns/unsubscribe"><input type="hidden" name="token" value="'+token+'"><button type="submit">Cancelar suscripción</button></form>'));
 });
 app.post('/api/campaigns/unsubscribe',express.urlencoded({extended:false,limit:'4kb'}),async(req,res,next)=>{
  try{
   const token=String(req.body?.token||'');
   const data=validate(token);if(!data)return res.status(400).type('html').send(html('Enlace inválido.'));
   await query("UPDATE crm_contact_consents SET opted_in=false,source='unsubscribe',updated_at=now() WHERE company_id=$1 AND contact_id=$2 AND channel='email'",[data.company,data.contact]);
   await query("UPDATE crm_campaign_deliveries SET status='skipped',error_code='unsubscribed' WHERE company_id=$1 AND contact_id=$2 AND status='queued' AND campaign_id IN (SELECT id FROM crm_campaigns WHERE company_id=$1 AND channel='email')",[data.company,data.contact]);
   res.type('html').send(html('Tu suscripción a correos comerciales fue cancelada.'));
  }catch(e){next(e)}
 });
}
