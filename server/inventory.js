import {Router} from 'express';
import {query} from './db.js';
import {isIP} from 'node:net';
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
const editor=(req,res,next)=>['owner','manager'].includes(req.user.role)?next():res.status(403).json({error:'Only managers may modify inventory'});
const kinds=['product','vehicle','property','service'],statuses=['available','reserved','sold','inactive'];
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
const decimal=x=>x!==''&&x!==null&&x!==undefined&&Number.isFinite(Number(x))&&Number(x)>=0&&Number(x)<=999999999999;
const validate=b=>typeof b.name==='string'&&b.name.trim().length>0&&b.name.length<=180&&kinds.includes(b.kind)&&statuses.includes(b.status)&&decimal(b.price)&&decimal(b.quantity)&&['BRL','USD','UYU','ARS','EUR'].includes(b.currency)&&(!b.sku||String(b.sku).length<=100)&&(!b.description||String(b.description).length<=5000)&&(!b.image_url||(/^https:\/\//.test(b.image_url)&&b.image_url.length<=2048))&&b.attributes&&typeof b.attributes==='object'&&!Array.isArray(b.attributes)&&JSON.stringify(b.attributes).length<=12000;
const evolution=()=>({url:String(process.env.EVOLUTION_API_URL||'').replace(/\/$/,''),key:process.env.EVOLUTION_API_KEY||''});
const remote=async(e,instance,route,payload)=>{let response;try{response=await fetch(e.url+'/message/'+route+'/'+encodeURIComponent(instance),{method:'POST',headers:{apikey:e.key,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(18000)})}catch{throw Object.assign(new Error('Evolution API unavailable'),{status:502})}if(!response.ok)throw Object.assign(new Error('Evolution API rejected media or text (HTTP '+response.status+')'),{status:502});return response.json().catch(()=>({}))};
const publicImage=value=>{try{const u=new URL(value);return u.protocol==='https:'&&u.username===''&&u.password===''&&u.hostname!=='localhost'&&!isIP(u.hostname)&&!u.hostname.endsWith('.local')&&u.href.length<=2048}catch{return false}};
const renderItem=(x,locale)=>{const p=new Intl.NumberFormat(locale==='es'?'es-UY':locale==='en'?'en-US':'pt-BR',{style:'currency',currency:x.currency||'BRL'}).format(Number(x.price));const status=Number(x.quantity)>0&&x.status==='available'?(locale==='es'?'Disponible':locale==='en'?'Available':'Disponível'):(locale==='es'?'Consultar disponibilidad':locale==='en'?'Check availability':'Consultar disponibilidade');return [x.name,x.description,p,status,x.sku?'SKU: '+x.sku:''].filter(Boolean).join('\n')};
export function registerInventoryRoutes(app,auth){
 const r=Router();r.use(auth);
 r.get('/inventory',wrap(async(req,res)=>{const kind=kinds.includes(req.query.kind)?req.query.kind:null;const term=String(req.query.search||'').slice(0,100);const rows=await query('SELECT * FROM crm_inventory_items WHERE company_id=$1 AND ($2::text IS NULL OR kind=$2) AND ($3::text=\'\' OR name ILIKE \'%\'||$3||\'%\' OR sku ILIKE \'%\'||$3||\'%\') ORDER BY updated_at DESC LIMIT 300',[req.user.company_id,kind,term]);res.json(rows.rows)}));
 r.get('/inventory/:id',wrap(async(req,res)=>{if(!uuid(req.params.id))return res.sendStatus(400);const x=await query('SELECT * FROM crm_inventory_items WHERE company_id=$1 AND id=$2',[req.user.company_id,req.params.id]);if(!x.rowCount)return res.sendStatus(404);res.json(x.rows[0])}));
 r.post('/inventory',editor,wrap(async(req,res)=>{const b=req.body||{};if(!validate(b))return res.status(400).json({error:'Invalid inventory item'});const x=await query('INSERT INTO crm_inventory_items(company_id,kind,name,sku,description,price,currency,quantity,status,image_url,attributes,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING *',[req.user.company_id,b.kind,b.name.trim(),b.sku?.trim()||null,b.description||'',b.price,b.currency,b.quantity,b.status,b.image_url||null,JSON.stringify(b.attributes),req.user.id]);res.status(201).json(x.rows[0])}));
 r.put('/inventory/:id',editor,wrap(async(req,res)=>{if(!uuid(req.params.id))return res.sendStatus(400);const b=req.body||{};if(!validate(b))return res.status(400).json({error:'Invalid inventory item'});const old=await query('SELECT * FROM crm_inventory_items WHERE company_id=$1 AND id=$2',[req.user.company_id,req.params.id]);if(!old.rowCount)return res.sendStatus(404);const x=await query('UPDATE crm_inventory_items SET kind=$3,name=$4,sku=$5,description=$6,price=$7,currency=$8,quantity=$9,status=$10,image_url=$11,attributes=$12,updated_by=$13,updated_at=now() WHERE company_id=$1 AND id=$2 RETURNING *',[req.user.company_id,req.params.id,b.kind,b.name.trim(),b.sku?.trim()||null,b.description||'',b.price,b.currency,b.quantity,b.status,b.image_url||null,JSON.stringify(b.attributes),req.user.id]);const previous=old.rows[0],current=x.rows[0];if(Number(previous.quantity)!==Number(current.quantity))await query('INSERT INTO crm_inventory_movements(company_id,item_id,actor_id,previous_quantity,new_quantity,reason) VALUES($1,$2,$3,$4,$5,$6)',[req.user.company_id,current.id,req.user.id,previous.quantity,current.quantity,'manual']);if(Number(previous.quantity)===0&&Number(current.quantity)>0)await query("INSERT INTO crm_inventory_notifications(company_id,item_id,event_type,old_value,new_value) VALUES($1,$2,'restock',$3,$4)",[req.user.company_id,current.id,String(previous.quantity),String(current.quantity)]);if(Number(previous.price)!==Number(current.price))await query("INSERT INTO crm_inventory_notifications(company_id,item_id,event_type,old_value,new_value) VALUES($1,$2,'price_change',$3,$4)",[req.user.company_id,current.id,String(previous.price),String(current.price)]);res.json(current)}));
 r.get('/inventory/:id/movements',wrap(async(req,res)=>{if(!uuid(req.params.id))return res.sendStatus(400);const x=await query('SELECT * FROM crm_inventory_movements WHERE company_id=$1 AND item_id=$2 ORDER BY created_at DESC LIMIT 100',[req.user.company_id,req.params.id]);res.json(x.rows)}));
 r.get('/inventory-notifications',editor,wrap(async(req,res)=>{const x=await query("SELECT n.*,i.name AS item_name FROM crm_inventory_notifications n JOIN crm_inventory_items i ON i.company_id=n.company_id AND i.id=n.item_id WHERE n.company_id=$1 ORDER BY n.created_at DESC LIMIT 100",[req.user.company_id]);res.json(x.rows)}));
 r.post('/inventory/:id/interests',editor,wrap(async(req,res)=>{if(!uuid(req.params.id)||!uuid(req.body?.contact_id))return res.sendStatus(400);const x=await query('INSERT INTO crm_inventory_interests(company_id,item_id,contact_id,notify_on_restock,notify_on_price_change) SELECT $1,$2,c.id,$4,$5 FROM contacts c JOIN crm_inventory_items i ON i.company_id=c.company_id AND i.id=$2 WHERE c.company_id=$1 AND c.id=$3 ON CONFLICT(company_id,item_id,contact_id) DO UPDATE SET notify_on_restock=EXCLUDED.notify_on_restock,notify_on_price_change=EXCLUDED.notify_on_price_change RETURNING *',[req.user.company_id,req.params.id,req.body.contact_id,req.body.notify_on_restock!==false,req.body.notify_on_price_change===true]);if(!x.rowCount)return res.sendStatus(404);res.status(201).json(x.rows[0])}));
 r.post('/conversations/:id/inventory-send',wrap(async(req,res)=>{
 const ids=req.body?.item_ids,locale=['es','pt','en'].includes(req.body?.lang)?req.body.lang:'pt';
 if(!Array.isArray(ids)||ids.length<1||ids.length>8||new Set(ids).size!==ids.length||!ids.every(uuid))return res.status(400).json({error:'Select 1 to 8 different inventory items'});
 const args=[req.params.id,req.user.company_id,...(req.user.role==='agent'?[req.user.id]:[])];
 const convo=await query("SELECT external_id FROM conversations WHERE id=$1 AND company_id=$2 AND channel='whatsapp'"+(req.user.role==='agent'?' AND assignee_id=$3':''),args);
 if(!convo.rowCount)return res.status(404).json({error:'WhatsApp conversation unavailable'});
 const match=/^(crm-[a-z0-9-]{3,50}):(\d{8,15}|lid:\d{5,25})$/.exec(convo.rows[0].external_id||'');
 if(!match||match[2].startsWith('lid:'))return res.status(409).json({error:'Conversation has no verified WhatsApp phone number'});
 const inst=await query('SELECT id FROM crm_evolution_instances WHERE company_id=$1 AND name=$2',[req.user.company_id,match[1]]);
 if(!inst.rowCount)return res.status(403).json({error:'WhatsApp instance unavailable'});
 const e=evolution();if(!e.key||!e.url.startsWith('https://'))return res.status(503).json({error:'Evolution API HTTPS credentials missing'});
 const items=await query('SELECT * FROM crm_inventory_items WHERE company_id=$1 AND id=ANY($2::uuid[])',[req.user.company_id,ids]);
 if(items.rowCount!==ids.length)return res.status(404).json({error:'One or more inventory items unavailable'});
 const byId=new Map(items.rows.map(x=>[x.id,x]));const sent=[];
 for(const id of ids){const item=byId.get(id);if(item.status==='inactive'){return res.status(409).json({error:'Inactive item cannot be sent',sent})}
 const body=renderItem(item,locale);
 let result;
 try{result=item.image_url&&publicImage(item.image_url)?await remote(e,match[1],'sendMedia',{number:match[2],mediatype:'image',mimetype:/\.png(?:\?|$)/i.test(item.image_url)?'image/png':'image/jpeg',caption:body,media:item.image_url,fileName:'zarko-product.jpg'}):await remote(e,match[1],'sendText',{number:match[2],text:body})}catch(err){return res.status(err.status||502).json({error:err.message,sent})}
 const ext=result.key?.id?match[1]+':'+result.key.id:null;
 const saved=await query("INSERT INTO messages(conversation_id,sender_id,direction,body,external_id) VALUES($1,$2,'outbound',$3,$4) ON CONFLICT DO NOTHING RETURNING id",[req.params.id,req.user.id,body+(item.image_url&&publicImage(item.image_url)?'\n'+item.image_url:''),ext]);
 sent.push({item_id:id,message_id:saved.rows[0]?.id||null});
 }
 await query('UPDATE conversations SET updated_at=now() WHERE id=$1 AND company_id=$2',[req.params.id,req.user.company_id]);
 res.status(201).json({sent});
 }));
 // Notification events are queued for review; no unsolicited WhatsApp messages are sent.
 app.use('/api',r);
}
