import express from 'express';
import {createPublicKey,verify} from 'node:crypto';
import {query} from './db.js';
const b64url=b=>Buffer.from(b).toString('base64url');
function publicKey(raw){
 const bytes=Buffer.from(raw,'base64');
 if(bytes.length!==65||bytes[0]!==4)throw Error('invalid_sendgrid_public_key');
 return createPublicKey({key:{kty:'EC',crv:'P-256',x:b64url(bytes.subarray(1,33)),y:b64url(bytes.subarray(33,65))},format:'jwk'});
}
export function registerSendgridEvents(app){
 app.post('/api/webhooks/sendgrid',express.raw({type:'application/json',limit:'2mb'}),async(req,res,next)=>{
  try{
   if(!process.env.SENDGRID_EVENT_PUBLIC_KEY)return res.sendStatus(503);
   const signature=req.get('x-twilio-email-event-webhook-signature');
   const timestamp=req.get('x-twilio-email-event-webhook-timestamp');
   if(!signature||!/^\d{10}$/.test(timestamp||'')||Math.abs(Date.now()/1000-Number(timestamp))>600)return res.sendStatus(401);
   if(!Buffer.isBuffer(req.body))return res.sendStatus(400);
   const ok=verify('sha256',Buffer.concat([Buffer.from(timestamp),req.body]),publicKey(process.env.SENDGRID_EVENT_PUBLIC_KEY),Buffer.from(signature,'base64'));
   if(!ok)return res.sendStatus(401);
   const events=JSON.parse(req.body.toString('utf8'));
   if(!Array.isArray(events)||events.length>1000)return res.sendStatus(400);
   for(const event of events){
    if(!['bounce','dropped','spamreport','unsubscribe','group_unsubscribe'].includes(event.event))continue;
    const deliveryId=event.campaign_delivery_id||event.unique_args?.campaign_delivery_id;
    if(typeof deliveryId!=='string'||! /^[0-9a-f-]{36}$/i.test(deliveryId))continue;
    const d=await query("SELECT d.company_id,d.contact_id,lower(c.email) AS email FROM crm_campaign_deliveries d JOIN contacts c ON c.id=d.contact_id AND c.company_id=d.company_id JOIN crm_campaigns ca ON ca.id=d.campaign_id AND ca.channel='email' WHERE d.id=$1",[deliveryId]);
    if(!d.rowCount)continue;
    const {company_id,contact_id,email}=d.rows[0];
    await query("INSERT INTO crm_email_suppressions(company_id,email,reason) VALUES($1,$2,$3) ON CONFLICT(company_id,email) DO UPDATE SET reason=EXCLUDED.reason,updated_at=now()",[company_id,email,event.event]);
    await query("UPDATE crm_contact_consents SET opted_in=false,source=$3,updated_at=now() WHERE company_id=$1 AND contact_id=$2 AND channel='email'",[company_id,contact_id,'sendgrid_'+event.event]);
    await query("UPDATE crm_campaign_deliveries SET status='skipped',error_code=$3 WHERE company_id=$1 AND contact_id=$2 AND status='queued' AND campaign_id IN (SELECT id FROM crm_campaigns WHERE company_id=$1 AND channel='email')",[company_id,contact_id,event.event]);
   }
   res.sendStatus(204);
  }catch(err){next(err)}
 });
}
