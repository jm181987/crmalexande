import {query} from './db.js';
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
const config=()=>({url:String(process.env.EVOLUTION_API_URL||'').replace(/\/$/,''),key:process.env.EVOLUTION_API_KEY||''});
const safe=x=>String(x||'').replace(/[\r\n\t]/g,' ').slice(0,180);
const settings=async company=>{const r=await query('SELECT mode,instance_id FROM crm_inventory_waitlist_settings WHERE company_id=$1',[company]);return r.rows[0]||{mode:'manual',instance_id:null}};
export async function queueRestock(company,item,notification){
 await query(`INSERT INTO crm_inventory_waitlist_dispatches(company_id,notification_id,interest_id)
 SELECT $1,$3,w.id FROM crm_inventory_interests w JOIN contacts c ON c.id=w.contact_id AND c.company_id=w.company_id
 WHERE w.company_id=$1 AND w.item_id=$2 AND w.notify_on_restock=true AND w.whatsapp_opt_in=true
 AND NULLIF(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g'),'') IS NOT NULL
 ON CONFLICT(notification_id,interest_id) DO NOTHING`,[company,item,notification]);
}
async function dispatch(company,id){
 const claimed=await query(`UPDATE crm_inventory_waitlist_dispatches d SET status='sending',error=NULL
 WHERE d.id=$1 AND d.company_id=$2 AND d.status='pending'
 RETURNING d.id,d.interest_id,d.notification_id`,[id,company]);
 if(!claimed.rowCount)return {ok:false,error:'Already processed or unavailable'};
 const row=await query(`SELECT d.id,w.contact_id,c.phone,c.name AS contact_name,i.name AS item_name,i.price,i.currency,i.quantity,i.status AS item_status,
 n.event_type,n.created_at AS event_created
 FROM crm_inventory_waitlist_dispatches d JOIN crm_inventory_interests w ON w.id=d.interest_id AND w.company_id=d.company_id
 JOIN contacts c ON c.id=w.contact_id AND c.company_id=d.company_id
 JOIN crm_inventory_items i ON i.id=w.item_id AND i.company_id=d.company_id
 JOIN crm_inventory_notifications n ON n.id=d.notification_id AND n.company_id=d.company_id
 WHERE d.id=$1 AND d.company_id=$2 AND w.whatsapp_opt_in=true AND w.notify_on_restock=true`,[id,company]);
 const fail=async(status,error)=>{await query('UPDATE crm_inventory_waitlist_dispatches SET status=$3,error=$4 WHERE id=$1 AND company_id=$2',[id,company,status,error]);return {ok:false,error}};
 if(!row.rowCount)return fail('skipped','Contact no longer opted in');
 const x=row.rows[0];if(x.event_type!=='restock'||x.item_status!=='available'||Number(x.quantity)<=0)return fail('skipped','Item not available');
 const pref=await settings(company);if(!pref.instance_id)return fail('skipped','No WhatsApp instance selected');
 const inst=await query("SELECT name FROM crm_evolution_instances WHERE company_id=$1 AND id=$2 AND status NOT IN ('deleted')",[company,pref.instance_id]);if(!inst.rowCount)return fail('skipped','WhatsApp instance unavailable');
 const number=String(x.phone||'').replace(/\D/g,'');if(!/^\d{8,15}$/.test(number))return fail('skipped','Invalid contact phone');
 // WhatsApp free-form messages require a recent inbound customer message (24-hour service window).
 const window=await query(`SELECT v.id FROM conversations v JOIN messages m ON m.conversation_id=v.id
 WHERE v.company_id=$1 AND v.contact_id=$2 AND v.channel='whatsapp'
 AND v.external_id=$3 AND m.direction='inbound' AND m.created_at>now()-interval '24 hours'
 ORDER BY m.created_at DESC LIMIT 1`,[company,x.contact_id,inst.rows[0].name+':'+number]);
 if(!window.rowCount)return fail('skipped','No active 24-hour WhatsApp customer service window; approved template required');
 const e=config();const allowHttp=process.env.EVOLUTION_ALLOW_INSECURE_HTTP==='true'&&/^http:\/\/(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?$/.test(e.url);
 if(!e.key||!(e.url.startsWith('https://')||allowHttp))return fail('skipped','Evolution API not configured');
 const body='Hola '+safe(x.contact_name)+' 👋\n¡Ya tenemos disponible el producto que estabas esperando!\n📦 '+safe(x.item_name)+'\n💰 '+x.price+' '+x.currency+'\n¿Querés que te lo reservemos?';
 let result;try{
  const response=await fetch(e.url+'/message/sendText/'+encodeURIComponent(inst.rows[0].name),{method:'POST',headers:{apikey:e.key,'Content-Type':'application/json'},body:JSON.stringify({number,text:body}),signal:AbortSignal.timeout(18000)});
  if(!response.ok)return fail('failed','Evolution HTTP '+response.status);
  result=await response.json().catch(()=>({}));
 }catch{return fail('unknown','Evolution timed out; verify WhatsApp before retrying')}
 if(result.error||result.status==='error'||!result.key?.id)return fail('unknown','Evolution did not confirm acceptance; verify WhatsApp');
 await query("UPDATE crm_inventory_waitlist_dispatches SET status='accepted',evolution_message_id=$3,sent_at=now() WHERE id=$1 AND company_id=$2",[id,company,String(result.key.id)]);
 await query('UPDATE crm_inventory_interests SET notified_at=now() WHERE id=$1 AND company_id=$2',[claimed.rows[0].interest_id,company]);
 await query("INSERT INTO messages(conversation_id,direction,body,external_id) VALUES($1,'outbound',$2,$3) ON CONFLICT DO NOTHING",[window.rows[0].id,body,inst.rows[0].name+':'+result.key.id]);
 return {ok:true,status:'accepted_by_evolution'};
}
export async function processRestock(company,notification){
 const pref=await settings(company);if(pref.mode!=='automatic')return;
 const rows=await query("SELECT id FROM crm_inventory_waitlist_dispatches WHERE company_id=$1 AND notification_id=$2 AND status='pending' ORDER BY created_at LIMIT 50",[company,notification]);
 for(const row of rows.rows){try{await dispatch(company,row.id)}catch(e){console.warn('Waitlist auto dispatch error',e.code||e.message)}}
}
export function registerWaitlistRoutes(router,editor){
 router.get('/inventory/waitlist/settings',wrap(async(req,res)=>{res.json(await settings(req.user.company_id))}));
 router.put('/inventory/waitlist/settings',editor,wrap(async(req,res)=>{
  const {mode,instance_id}=req.body||{};if(!['manual','automatic'].includes(mode)||!(instance_id===null||uuid(instance_id)))return res.sendStatus(400);
  if(instance_id){const inst=await query("SELECT id FROM crm_evolution_instances WHERE company_id=$1 AND id=$2 AND status<>'deleted'",[req.user.company_id,instance_id]);if(!inst.rowCount)return res.status(400).json({error:'WhatsApp instance unavailable'});}
  const r=await query(`INSERT INTO crm_inventory_waitlist_settings(company_id,mode,instance_id) VALUES($1,$2,$3)
  ON CONFLICT(company_id) DO UPDATE SET mode=EXCLUDED.mode,instance_id=EXCLUDED.instance_id,updated_at=now() RETURNING mode,instance_id`,[req.user.company_id,mode,instance_id]);res.json(r.rows[0]);
 }));
 router.get('/inventory/waitlist/contacts',wrap(async(req,res)=>{const r=await query("SELECT id,name,phone FROM contacts WHERE company_id=$1 AND phone IS NOT NULL ORDER BY name LIMIT 500",[req.user.company_id]);res.json(r.rows)}));
 router.get('/inventory/:id/waitlist',wrap(async(req,res)=>{
  if(!uuid(req.params.id))return res.sendStatus(400);
  const rows=await query(`SELECT w.id,w.contact_id,c.name,c.phone,w.whatsapp_opt_in,w.notify_on_restock,w.created_at
  FROM crm_inventory_interests w JOIN contacts c ON c.id=w.contact_id AND c.company_id=w.company_id
  JOIN crm_inventory_items i ON i.id=w.item_id AND i.company_id=w.company_id
  WHERE w.company_id=$1 AND w.item_id=$2`+' ORDER BY w.created_at DESC',[req.user.company_id,req.params.id]);res.json(rows.rows);
 }));
 router.post('/inventory/:id/waitlist',editor,wrap(async(req,res)=>{
  const {contact_id}=req.body||{};
  if(!uuid(req.params.id)||!uuid(contact_id))return res.status(400).json({error:'Valid product and contact are required'});
  const r=await query(`INSERT INTO crm_inventory_interests(company_id,item_id,contact_id,notify_on_restock,whatsapp_opt_in)
  SELECT $1,i.id,c.id,true,true FROM crm_inventory_items i JOIN contacts c ON c.company_id=i.company_id
  WHERE i.company_id=$1 AND i.id=$2 AND c.id=$3`+`
  ON CONFLICT(company_id,item_id,contact_id) DO UPDATE SET notify_on_restock=true,whatsapp_opt_in=true RETURNING id`,[req.user.company_id,req.params.id,contact_id]);
  if(!r.rowCount)return res.sendStatus(404);res.status(201).json(r.rows[0]);
 }));
 router.delete('/inventory/:id/waitlist/:contact',editor,wrap(async(req,res)=>{
  if(!uuid(req.params.id)||!uuid(req.params.contact))return res.sendStatus(400);
  await query(`UPDATE crm_inventory_interests w SET whatsapp_opt_in=false,notify_on_restock=false
  WHERE w.company_id=$1 AND w.item_id=$2 AND w.contact_id=$3
  AND EXISTS(SELECT 1 FROM crm_inventory_items i WHERE i.id=w.item_id AND i.company_id=w.company_id`+')',[req.user.company_id,req.params.id,req.params.contact]);res.json({ok:true});
 }));
 router.get('/inventory/waitlist/dispatches',wrap(async(req,res)=>{
  const r=await query(`SELECT d.id,d.status,d.error,d.created_at,c.name AS contact_name,i.name AS item_name
  FROM crm_inventory_waitlist_dispatches d JOIN crm_inventory_interests w ON w.id=d.interest_id AND w.company_id=d.company_id
  JOIN contacts c ON c.id=w.contact_id AND c.company_id=d.company_id JOIN crm_inventory_items i ON i.id=w.item_id AND i.company_id=d.company_id
  WHERE d.company_id=$1`+' ORDER BY d.created_at DESC LIMIT 200',[req.user.company_id]);res.json(r.rows);
 }));
 router.post('/inventory/waitlist/dispatches/:id/send',editor,wrap(async(req,res)=>{
  if(!uuid(req.params.id))return res.sendStatus(400);
  const visible=await query(`SELECT d.id FROM crm_inventory_waitlist_dispatches d JOIN crm_inventory_interests w ON w.id=d.interest_id AND w.company_id=d.company_id JOIN crm_inventory_items i ON i.id=w.item_id AND i.company_id=d.company_id
  WHERE d.company_id=$1 AND d.id=$2`,[req.user.company_id,req.params.id]);if(!visible.rowCount)return res.sendStatus(404);
  const result=await dispatch(req.user.company_id,req.params.id);res.status(result.ok?200:409).json(result);
 }));
}
