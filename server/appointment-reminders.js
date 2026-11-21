import {query} from './db.js';

const offsets=[180,60,10];
export async function queueAppointmentReminders(appointment){
 if(!appointment?.contact_id)throw Error('contact_required_for_reminders');
 const contact=await query("SELECT c.phone FROM contacts c JOIN crm_contact_consents co ON co.company_id=c.company_id AND co.contact_id=c.id AND co.channel='whatsapp' AND co.opted_in=true WHERE c.id=$1 AND c.company_id=$2",[appointment.contact_id,appointment.company_id]);
 if(!contact.rowCount)throw Error('whatsapp_consent_required');
 if(!/^\+?\d{8,15}$/.test(contact.rows[0].phone||''))throw Error('valid_whatsapp_phone_required');
 for(const offset of offsets){
  const due=new Date(new Date(appointment.start_at).getTime()-offset*60000);
  if(due.getTime()<=Date.now())continue;
  await query("INSERT INTO crm_appointment_reminders(company_id,appointment_id,offset_minutes,due_at) VALUES($1,$2,$3,$4) ON CONFLICT(appointment_id,offset_minutes) DO NOTHING",[appointment.company_id,appointment.id,offset,due.toISOString()]);
 }
}
export async function dispatchAppointmentReminders({limit=20}={}){
 if(process.env.CRM_APPOINTMENT_REMINDERS_ENABLED!=='true')return {disabled:true};
 const url=(process.env.EVOLUTION_API_URL||'').replace(/\/$/,'');
 if(!url||!process.env.EVOLUTION_API_KEY)return {disabled:true,reason:'evolution_not_configured'};
 const rows=await query("SELECT r.id,r.company_id,r.offset_minutes,a.title,a.start_at,a.status,c.name AS contact_name,c.phone FROM crm_appointment_reminders r JOIN appointments a ON a.id=r.appointment_id AND a.company_id=r.company_id JOIN contacts c ON c.id=a.contact_id AND c.company_id=a.company_id JOIN crm_contact_consents co ON co.company_id=c.company_id AND co.contact_id=c.id AND co.channel='whatsapp' AND co.opted_in=true WHERE r.status='pending' AND r.due_at<=now() AND r.due_at>now()-interval '5 minutes' AND a.start_at>now() AND a.status='scheduled' ORDER BY r.due_at LIMIT $1",[Math.min(50,Math.max(1,limit))]);
 let sent=0,failed=0,skipped=0;
 for(const r of rows.rows){
  const claim=await query("UPDATE crm_appointment_reminders SET status='sending' WHERE id=$1 AND status='pending' AND EXISTS(SELECT 1 FROM appointments a JOIN crm_contact_consents co ON co.company_id=a.company_id AND co.contact_id=a.contact_id AND co.channel='whatsapp' AND co.opted_in=true WHERE a.id=crm_appointment_reminders.appointment_id AND a.company_id=crm_appointment_reminders.company_id AND a.status='scheduled' AND a.start_at>now()) RETURNING id",[r.id]);
  if(!claim.rowCount)continue;
  try{
   if(!/^\+?\d{8,15}$/.test(r.phone||''))throw Error('invalid_phone');
   const inst=await query("SELECT name FROM crm_evolution_instances WHERE company_id=$1 AND status IN ('open','connected') ORDER BY created_at DESC LIMIT 1",[r.company_id]);
   if(!inst.rowCount)throw Error('no_connected_evolution_instance');
   const minutes=r.offset_minutes===180?'3 horas':r.offset_minutes===60?'1 hora':'10 minutos';
   const when=new Date(r.start_at).toLocaleString('es-UY',{timeZone:process.env.CRM_APPOINTMENT_TIMEZONE||'America/Montevideo',dateStyle:'short',timeStyle:'short'});
   const message='Hola '+r.contact_name+', te recordamos tu cita: '+r.title+'. Fecha y hora: '+when+'. Faltan aproximadamente '+minutes+'.';
   const response=await fetch(url+'/message/sendText/'+encodeURIComponent(inst.rows[0].name),{method:'POST',headers:{apikey:process.env.EVOLUTION_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({number:r.phone.replace(/^\+/,''),text:message}),signal:AbortSignal.timeout(12000)});
   if(!response.ok)throw Error('evolution_http_'+response.status);
   const data=await response.json().catch(()=>({}));
   await query("UPDATE crm_appointment_reminders SET status='sent',sent_at=now(),external_id=$2,error_code=NULL WHERE id=$1",[r.id,data.key?.id||null]);sent++;
  }catch(e){await query("UPDATE crm_appointment_reminders SET status='failed',error_code=$2 WHERE id=$1",[r.id,String(e.message).slice(0,120)]);failed++}
 }
 const old=await query("UPDATE crm_appointment_reminders r SET status='skipped',error_code='expired_or_cancelled' FROM appointments a WHERE a.id=r.appointment_id AND a.company_id=r.company_id AND r.status='pending' AND (r.due_at<=now()-interval '5 minutes' OR a.start_at<=now() OR a.status<>'scheduled') RETURNING r.id");
 skipped=old.rowCount;
 return {sent,failed,skipped};
}


const phoneDigits=value=>{const v=String(value||'').replace(/@s\.whatsapp\.net$/,'').replace(/^\+/,'');return /^\d{8,15}$/.test(v)?v:null};
async function commercialInstance(companyId){
 const result=await query("SELECT name FROM crm_evolution_instances WHERE company_id=$1 AND status IN ('open','connected') ORDER BY created_at DESC LIMIT 1",[companyId]);
 return result.rows[0]?.name||null;
}
async function commercialNumber(instance,url,key){
 const response=await fetch(url+'/instance/fetchInstances?instanceName='+encodeURIComponent(instance),{headers:{apikey:key},signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw Error('evolution_instance_lookup_'+response.status);
 const raw=await response.json(),items=Array.isArray(raw)?raw:[raw];
 const match=items.find(x=>x?.name===instance||x?.instance?.instanceName===instance)||items[0];
 return phoneDigits(match?.ownerJid)||phoneDigits(match?.instance?.ownerJid)||phoneDigits(match?.number)||phoneDigits(match?.instance?.number)||phoneDigits(match?.instance?.owner);
}
export async function queueInternalAppointmentReminders(appointment){
 for(const offset of offsets){
  const due=new Date(new Date(appointment.start_at).getTime()-offset*60000);
  if(due.getTime()<=Date.now())continue;
  await query("INSERT INTO crm_internal_appointment_reminders(company_id,appointment_id,offset_minutes,due_at) VALUES($1,$2,$3,$4) ON CONFLICT(appointment_id,offset_minutes) DO NOTHING",[appointment.company_id,appointment.id,offset,due.toISOString()]);
 }
}
export async function dispatchInternalAppointmentReminders({limit=20}={}){
 if(process.env.CRM_APPOINTMENT_REMINDERS_ENABLED!=='true')return {disabled:true};
 const url=(process.env.EVOLUTION_API_URL||'').replace(/\/$/,'');
 const key=process.env.EVOLUTION_API_KEY;
 if(!url||!key)return {disabled:true,reason:'evolution_not_configured'};
 const rows=await query("SELECT r.id,r.company_id,r.offset_minutes,a.title,a.start_at FROM crm_internal_appointment_reminders r JOIN appointments a ON a.id=r.appointment_id AND a.company_id=r.company_id WHERE r.status='pending' AND r.due_at<=now() AND r.due_at>now()-interval '5 minutes' AND a.start_at>now() AND a.status='scheduled' ORDER BY r.due_at LIMIT $1",[Math.min(50,Math.max(1,limit))]);
 let sent=0,failed=0;
 for(const item of rows.rows){
  const claim=await query("UPDATE crm_internal_appointment_reminders SET status='sending' WHERE id=$1 AND status='pending' RETURNING id",[item.id]);
  if(!claim.rowCount)continue;
  try{
   const instance=await commercialInstance(item.company_id);
   if(!instance)throw Error('no_connected_evolution_instance');
   const number=await commercialNumber(instance,url,key);
   if(!number)throw Error('commercial_whatsapp_number_unavailable');
   const when=new Date(item.start_at).toLocaleString('es-UY',{timeZone:process.env.CRM_APPOINTMENT_TIMEZONE||'America/Montevideo',dateStyle:'short',timeStyle:'short'});
   const lead=item.offset_minutes===180?'3 horas':item.offset_minutes===60?'1 hora':'10 minutos';
   const message='Recordatorio de cita: '+item.title+'. Fecha y hora: '+when+'. Faltan '+lead+'.';
   const response=await fetch(url+'/message/sendText/'+encodeURIComponent(instance),{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({number,text:message}),signal:AbortSignal.timeout(12000)});
   if(!response.ok)throw Error('evolution_http_'+response.status);
   const data=await response.json().catch(()=>({}));
   await query("UPDATE crm_internal_appointment_reminders SET status='sent',sent_at=now(),external_id=$2,error_code=NULL WHERE id=$1",[item.id,data.key?.id||null]);sent++;
  }catch(e){await query("UPDATE crm_internal_appointment_reminders SET status='failed',error_code=$2 WHERE id=$1",[item.id,String(e.message).slice(0,120)]);failed++}
 }
 await query("UPDATE crm_internal_appointment_reminders r SET status='skipped',error_code='expired_or_cancelled' FROM appointments a WHERE a.id=r.appointment_id AND a.company_id=r.company_id AND r.status='pending' AND (r.due_at<=now()-interval '5 minutes' OR a.start_at<=now() OR a.status<>'scheduled')");
 return {sent,failed};
}
