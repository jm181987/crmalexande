import {signedMediaPath,mediaAuthorized} from './media-access.js';
import {Router} from 'express';
import {query} from './db.js';
import {isIP} from 'node:net';
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
const editor=(req,res,next)=>['owner','manager'].includes(req.user.role)?next():res.status(403).json({error:'Only managers may modify inventory'});
const kinds=['product','vehicle','property','service'],statuses=['available','reserved','sold','inactive'];
const itemScope=(req,alias='',position=4)=>req.user.role==='owner'?'':` AND ${alias}created_by=${position}`;
const itemArgs=(req,...values)=>req.user.role==='owner'?values:[...values,req.user.id];
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
const decimal=x=>x!==''&&x!==null&&x!==undefined&&Number.isFinite(Number(x))&&Number(x)>=0&&Number(x)<=999999999999;
const validate=b=>typeof b.name==='string'&&b.name.trim().length>0&&b.name.length<=180&&kinds.includes(b.kind)&&statuses.includes(b.status)&&decimal(b.price)&&decimal(b.quantity)&&['BRL','USD','UYU','ARS','EUR'].includes(b.currency)&&(!b.sku||String(b.sku).length<=100)&&(!b.description||String(b.description).length<=5000)&&(!b.image_url||(typeof b.image_url==='string'&&b.image_url.length<=2048&&(publicImage(b.image_url)||/^\/api\/public\/inventory-image\/[0-9a-f-]{36}$/i.test(b.image_url))))&&(b.attributes===undefined||b.attributes===null||typeof b.attributes==='object')&&!Array.isArray(b.attributes||{})&&JSON.stringify(b.attributes||{}).length<=12000;
const evolution=()=>({url:String(process.env.EVOLUTION_API_URL||'').replace(/\/$/,''),key:process.env.EVOLUTION_API_KEY||''});
const remote=async(e,instance,route,payload)=>{let response;try{response=await fetch(e.url+'/message/'+route+'/'+encodeURIComponent(instance),{method:'POST',headers:{apikey:e.key,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(18000)})}catch{throw Object.assign(new Error('Evolution API unavailable'),{status:502})}if(!response.ok){const detail=await response.text().catch(()=>'');console.error('Evolution inventory media failed',{status:response.status,route,detail:detail.slice(0,500)});throw Object.assign(new Error('Evolution API rejected '+route+' (HTTP '+response.status+'). Verify the Evolution instance media configuration.'),{status:502})}return response.json().catch(()=>({}))};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const publicImage=value=>{try{const u=new URL(value);return u.protocol==='https:'&&u.username===''&&u.password===''&&u.hostname!=='localhost'&&!isIP(u.hostname)&&!u.hostname.endsWith('.local')&&u.href.length<=2048}catch{return false}};
const renderItem=(x,locale,contactUrl='')=>{
 const language=['es','pt','en'].includes(locale)?locale:'pt';
 const labels={es:{price:'Precio',availability:'Disponibilidad',available:'Disponible',reserved:'Reservado',sold:'Vendido',unavailable:'Consultar',reference:'Referencia',details:'Detalles',units:'unidades',contact:'Consultanos para más información'},pt:{price:'Preço',availability:'Disponibilidade',available:'Disponível',reserved:'Reservado',sold:'Vendido',unavailable:'Consultar',reference:'Referência',details:'Detalhes',units:'unidades',contact:'Fale conosco para mais informações'},en:{price:'Price',availability:'Availability',available:'Available',reserved:'Reserved',sold:'Sold',unavailable:'Ask us',reference:'Reference',details:'Details',units:'units',contact:'Contact us for more information'}}[language];
 const money=new Intl.NumberFormat(language==='es'?'es-UY':language==='en'?'en-US':'pt-BR',{style:'currency',currency:x.currency||'BRL'}).format(Number(x.price));
 const state=x.status==='available'?(Number(x.quantity)>0?labels.available:labels.unavailable):labels[x.status]||labels.unavailable;
 const kind={product:'📦',vehicle:'🚗',property:'🏠',service:'🛠️'}[x.kind]||'📦';
 const lines=[kind+' *'+String(x.name).replace(/[\r\n*]/g,' ').trim()+'*','', '💰 *'+labels.price+':* '+money,'✅ *'+labels.availability+':* '+state+(x.kind==='product'&&Number(x.quantity)>0?' ('+x.quantity+' '+labels.units+')':'')];
 if(x.sku)lines.push('🔖 *'+labels.reference+':* '+x.sku);
 if(x.description?.trim())lines.push('', '📝 *'+labels.details+':*',x.description.trim().slice(0,1200));
 if(x.attributes&&typeof x.attributes==='object'){const details=Object.entries(x.attributes).filter(([k,v])=>k&&v!==null&&v!==''&&typeof v!=='object').slice(0,6);if(details.length)lines.push('',...details.map(([k,v])=>'• '+k+': '+String(v).slice(0,100)))}
 if(contactUrl)lines.push('', '💬 *'+labels.contact+':*',contactUrl);
 return lines.join('\n').slice(0,3500);
};
// Internal inventory photos are portable across public domain changes.
const portableImageUrl=value=>{if(typeof value!=='string')return value;try{const u=new URL(value);const match=u.pathname.match(/^\/api\/public\/inventory-image\/([0-9a-f-]{36})$/i);if(u.protocol==='https:'&&match&&uuid(match[1]))return '/api/public/inventory-image/'+match[1]}catch{}return value};
const photosOf=x=>{const gallery=Array.isArray(x.attributes?._image_urls)?x.attributes._image_urls:[];return [...new Set([x.image_url,...gallery].filter(Boolean).map(portableImageUrl))].slice(0,12)};

const imageList=b=>{const raw=b.image_urls===undefined?[b.image_url].filter(Boolean):b.image_urls;return Array.isArray(raw)&&raw.length<=12&&raw.every(x=>typeof x==='string'&&(publicImage(x)||/^\/api\/public\/inventory-image\/[0-9a-f-]{36}$/i.test(x)))&&new Set(raw).size===raw.length?raw:null};
const storeGallery=b=>{const images=imageList(b);if(!images)return null;const attrs={...(b.attributes||{})};delete attrs._image_urls;return {image_url:images[0]||null,attributes:JSON.stringify({...attrs,_image_urls:images})}};
const itemView=x=>({...x,image_url:portableImageUrl(x.image_url),image_urls:photosOf(x)});
export function registerInventoryRoutes(app,auth){
 const r=Router();r.use(auth);
 r.post('/inventory-images/upload',editor,wrap(async(req,res)=>{
  const raw=req.body?.data, mime=req.body?.mime;
  if(!['image/jpeg','image/png','image/webp'].includes(mime)||typeof raw!=='string'||raw.length>2900000||!/^[A-Za-z0-9+/]+={0,2}$/.test(raw))return res.status(400).json({error:'Use JPG, PNG or WebP images up to 2 MB'});
  const bytes=Buffer.from(raw,'base64');if(bytes.length<32||bytes.length>2097152)return res.status(400).json({error:'Image must be smaller than 2 MB'});
  const signature=mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:mime==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
  if(!signature)return res.status(400).json({error:'Invalid image content'});
  const origin=String(process.env.PUBLIC_APP_URL||(process.env.VERCEL_PROJECT_PRODUCTION_URL?'https://'+process.env.VERCEL_PROJECT_PRODUCTION_URL:'')).replace(/\/$/,'');
  // Internal image URLs are relative to the active domain; no PUBLIC_APP_URL dependency.
  let row;
  try{row=await query('INSERT INTO crm_inventory_images(company_id,uploaded_by,mime,content) VALUES($1,$2,$3,$4) RETURNING id',[req.user.company_id,req.user.id,mime,bytes])}
  catch(err){
   if(err.code==='42P01'||err.code==='42883')return res.status(503).json({error:'La tabla de fotografías no existe. Ejecutá scripts/inventory.sql en PostgreSQL de producción.'});
   if(err.code==='42501')return res.status(503).json({error:'La base de datos no permite guardar fotografías. Revisá los permisos y las políticas RLS de crm_inventory_images.'});
   throw err;
  }
  const url=signedMediaPath('inventory',row.rows[0].id,7*86400);
  res.status(201).json({url,id:row.rows[0].id,stored:true});
 }));
 r.get('/inventory/contact-settings',wrap(async(req,res)=>{const x=await query('SELECT whatsapp_url FROM crm_inventory_contact_settings WHERE company_id=$1',[req.user.company_id]);res.json({whatsapp_url:x.rows[0]?.whatsapp_url||''})}));
 r.put('/inventory/contact-settings',editor,wrap(async(req,res)=>{const raw=String(req.body?.whatsapp_url||'').trim();let url='';if(raw){try{const parsed=new URL(raw);if(parsed.protocol!=='https:'||!['wa.me','api.whatsapp.com','www.wa.me'].includes(parsed.hostname.toLowerCase())||raw.length>500)throw Error('invalid');url=parsed.href}catch{return res.status(400).json({error:'Ingresá un enlace válido de WhatsApp: https://wa.me/...'})}}const x=await query('INSERT INTO crm_inventory_contact_settings(company_id,whatsapp_url) VALUES($1,$2) ON CONFLICT(company_id) DO UPDATE SET whatsapp_url=EXCLUDED.whatsapp_url,updated_at=now() RETURNING whatsapp_url',[req.user.company_id,url]);res.json(x.rows[0])}));
 r.get('/inventory',wrap(async(req,res)=>{const kind=kinds.includes(req.query.kind)?req.query.kind:null;const term=String(req.query.search||'').slice(0,100);const rows=await query('SELECT * FROM crm_inventory_items WHERE company_id=$1 AND ($2::text IS NULL OR kind=$2) AND ($3::text=\'\' OR name ILIKE \'%\'||$3||\'%\' OR sku ILIKE \'%\'||$3||\'%\') '+itemScope(req)+' ORDER BY updated_at DESC LIMIT 300',itemArgs(req,req.user.company_id,kind,term));res.json(rows.rows.map(itemView))}));
 r.get('/inventory/:id',wrap(async(req,res)=>{if(!uuid(req.params.id))return res.sendStatus(400);const x=await query('SELECT * FROM crm_inventory_items WHERE company_id=$1 AND id=$2'+(req.user.role==='owner'?'':' AND created_by=$3'),itemArgs(req,req.user.company_id,req.params.id));if(!x.rowCount)return res.sendStatus(404);res.json(itemView(x.rows[0]))}));
 r.post('/inventory',wrap(async(req,res)=>{const b=req.body||{};const gallery=storeGallery(b);if(!validate(b)||!gallery)return res.status(400).json({error:'Invalid inventory item: check name, type, status, currency, nonnegative price and quantity, photo URL and attributes'});const x=await query('INSERT INTO crm_inventory_items(company_id,kind,name,sku,description,price,currency,quantity,status,image_url,attributes,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING *',[req.user.company_id,b.kind,b.name.trim(),b.sku?.trim()||null,b.description||'',b.price,b.currency,b.quantity,b.status,gallery.image_url,gallery.attributes,req.user.id]);res.status(201).json(itemView(x.rows[0]))}));
 r.put('/inventory/:id',wrap(async(req,res)=>{if(!uuid(req.params.id))return res.sendStatus(400);const b=req.body||{};const gallery=storeGallery(b);if(!validate(b)||!gallery)return res.status(400).json({error:'Invalid inventory item'});const old=await query('SELECT * FROM crm_inventory_items WHERE company_id=$1 AND id=$2'+(req.user.role==='owner'?'':' AND created_by=$3'),itemArgs(req,req.user.company_id,req.params.id));if(!old.rowCount)return res.sendStatus(404);const x=await query('UPDATE crm_inventory_items SET kind=$3,name=$4,sku=$5,description=$6,price=$7,currency=$8,quantity=$9,status=$10,image_url=$11,attributes=$12,updated_by=$13,updated_at=now() WHERE company_id=$1 AND id=$2'+(req.user.role==='owner'?'':' AND created_by=$14')+' RETURNING *',req.user.role==='owner'?[req.user.company_id,req.params.id,b.kind,b.name.trim(),b.sku?.trim()||null,b.description||'',b.price,b.currency,b.quantity,b.status,gallery.image_url,gallery.attributes,req.user.id]:[req.user.company_id,req.params.id,b.kind,b.name.trim(),b.sku?.trim()||null,b.description||'',b.price,b.currency,b.quantity,b.status,gallery.image_url,gallery.attributes,req.user.id,req.user.id]);const previous=old.rows[0],current=x.rows[0];if(Number(previous.quantity)!==Number(current.quantity))await query('INSERT INTO crm_inventory_movements(company_id,item_id,actor_id,previous_quantity,new_quantity,reason) VALUES($1,$2,$3,$4,$5,$6)',[req.user.company_id,current.id,req.user.id,previous.quantity,current.quantity,'manual']);if(Number(previous.quantity)===0&&Number(current.quantity)>0)await query("INSERT INTO crm_inventory_notifications(company_id,item_id,event_type,old_value,new_value) VALUES($1,$2,'restock',$3,$4)",[req.user.company_id,current.id,String(previous.quantity),String(current.quantity)]);if(Number(previous.price)!==Number(current.price))await query("INSERT INTO crm_inventory_notifications(company_id,item_id,event_type,old_value,new_value) VALUES($1,$2,'price_change',$3,$4)",[req.user.company_id,current.id,String(previous.price),String(current.price)]);res.json(itemView(current))}));
 r.get('/inventory/:id/movements',wrap(async(req,res)=>{if(!uuid(req.params.id))return res.sendStatus(400);const x=await query('SELECT * FROM crm_inventory_movements WHERE company_id=$1 AND item_id=$2 AND EXISTS (SELECT 1 FROM crm_inventory_items i WHERE i.company_id=$1 AND i.id=$2'+(req.user.role==='owner'?'':' AND i.created_by=$3')+') ORDER BY created_at DESC LIMIT 100',itemArgs(req,req.user.company_id,req.params.id));res.json(x.rows)}));
 r.get('/inventory-notifications',editor,wrap(async(req,res)=>{const x=await query("SELECT n.*,i.name AS item_name FROM crm_inventory_notifications n JOIN crm_inventory_items i ON i.company_id=n.company_id AND i.id=n.item_id WHERE n.company_id=$1 ORDER BY n.created_at DESC LIMIT 100",[req.user.company_id]);res.json(x.rows)}));
 r.post('/inventory/:id/interests',wrap(async(req,res)=>{if(!uuid(req.params.id)||!uuid(req.body?.contact_id))return res.sendStatus(400);const x=await query('INSERT INTO crm_inventory_interests(company_id,item_id,contact_id,notify_on_restock,notify_on_price_change) SELECT $1,$2,c.id,$4,$5 FROM contacts c JOIN crm_inventory_items i ON i.company_id=c.company_id AND i.id=$2 WHERE c.company_id=$1 AND c.id=$3'+(req.user.role==='owner'?'':' AND i.created_by=$6')+' ON CONFLICT(company_id,item_id,contact_id) DO UPDATE SET notify_on_restock=EXCLUDED.notify_on_restock,notify_on_price_change=EXCLUDED.notify_on_price_change RETURNING *',[req.user.company_id,req.params.id,req.body.contact_id,req.body.notify_on_restock!==false,req.body.notify_on_price_change===true,...(req.user.role==='owner'?[]:[req.user.id])]);if(!x.rowCount)return res.sendStatus(404);res.status(201).json(x.rows[0])}));
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
 const e=evolution();const allowHttp=process.env.EVOLUTION_ALLOW_INSECURE_HTTP==='true'&&/^http:\/\/(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?$/.test(e.url);if(!e.key||!(e.url.startsWith('https://')||allowHttp))return res.status(503).json({error:'Evolution API connection unavailable. Check EVOLUTION_API_URL, EVOLUTION_API_KEY and configured HTTP/HTTPS policy'});
 const items=await query('SELECT * FROM crm_inventory_items WHERE company_id=$1 AND id=ANY($2::uuid[])'+(req.user.role==='owner'?'':' AND created_by=$3'),itemArgs(req,req.user.company_id,ids));
 if(items.rowCount!==ids.length)return res.status(404).json({error:'One or more inventory items unavailable'});
 const contact=await query('SELECT whatsapp_url FROM crm_inventory_contact_settings WHERE company_id=$1',[req.user.company_id]);const contactUrl=contact.rows[0]?.whatsapp_url||'';
 const byId=new Map(items.rows.map(x=>[x.id,x]));const sent=[];
 for(const id of ids){const item=byId.get(id);if(item.status==='inactive'){return res.status(409).json({error:'Inactive item cannot be sent',sent})}
 const body=renderItem(item,locale,contactUrl);const photos=photosOf(item);
 if(!photos.length||!photos.every(x=>publicImage(x)||/^\/api\/public\/inventory-image\/[0-9a-f-]{36}$/i.test(x)))return res.status(422).json({error:'Este artículo no tiene una fotografía HTTPS válida guardada. Abrí Stock → Editar, subí la foto y guardá el artículo antes de enviarlo.',item_id:id,sent});
 let photoIndex=0;
 for(const photo of photos){
  // Avoid flooding a single Evolution/WhatsApp instance with back-to-back media requests.
  if(photoIndex>0)await wait(1200);
  let result;
  try{
   const hosted=/^\/api\/public\/inventory-image\/([0-9a-f-]{36})$/i.exec(portableImageUrl(photo));
   let media=photo,mimetype=/\.png(?:\?|$)/i.test(photo)?'image/png':/\.webp(?:\?|$)/i.test(photo)?'image/webp':'image/jpeg';
   if(hosted){
    const image=await query('SELECT mime,content FROM crm_inventory_images WHERE company_id=$1 AND id=$2',[req.user.company_id,hosted[1]]);
    if(!image.rowCount)throw Object.assign(new Error('Inventory photo not found'),{status:404});
    mimetype=image.rows[0].mime;media=Buffer.from(image.rows[0].content).toString('base64');
   }
   result=await remote(e,match[1],'sendMedia',{number:match[2],mediatype:'image',mimetype,caption:photoIndex===0?body:'📷 '+(photoIndex+1)+'/'+photos.length+' — '+item.name,media,fileName:'inventory-'+id+'-'+(photoIndex+1)+'.'+(mimetype==='image/png'?'png':mimetype==='image/webp'?'webp':'jpg')});
   // HTTP 200 only means Evolution accepted the request, not that WhatsApp delivered it.
   // Do not report success when Evolution returns an error payload or no message key.
   if(result.error||result.status==='error'||!result.key?.id)throw Object.assign(new Error('Evolution did not confirm acceptance of photo '+(photoIndex+1)),{status:502});
  }catch(err){console.error('Inventory photo dispatch failed',{item_id:id,photo_index:photoIndex+1,total:photos.length,error:err.message});return res.status(err.status||502).json({error:err.message,sent,partial_item_id:id,photos_sent:photoIndex,photos_total:photos.length})}
  const ext=result.key?.id?match[1]+':'+result.key.id:null;
  const saved=await query("INSERT INTO messages(conversation_id,sender_id,direction,body,external_id) VALUES($1,$2,'outbound',$3,$4) ON CONFLICT DO NOTHING RETURNING id",[req.params.id,req.user.id,(photoIndex===0?body:'📷 '+(photoIndex+1)+'/'+photos.length+' — '+item.name)+'\n'+photo,ext]);
  sent.push({item_id:id,photo_index:photoIndex+1,message_id:saved.rows[0]?.id||null,delivery_status:'accepted_by_evolution'});
  photoIndex++;
 }

 }
 await query('UPDATE conversations SET updated_at=now() WHERE id=$1 AND company_id=$2',[req.params.id,req.user.company_id]);
 res.status(201).json({sent,delivery_status:'accepted_by_evolution',note:'La API aceptó los archivos, pero la entrega al destinatario no está confirmada.'});
 }));
 // Notification events are queued for review; no unsolicited WhatsApp messages are sent.
 app.get('/api/public/inventory-image/:id',wrap(async(req,res)=>{if(!uuid(req.params.id))return res.sendStatus(404);if(!mediaAuthorized(req,'inventory'))return res.sendStatus(404);const x=await query('SELECT * FROM public.crm_public_inventory_image($1)',[req.params.id]);if(!x.rowCount)return res.sendStatus(404);res.set('Content-Type',x.rows[0].mime);res.set('Cache-Control',process.env.CRM_MEDIA_REQUIRE_SIGNATURE==='true'?'private,no-store':'public, max-age=86400');res.set('X-Content-Type-Options','nosniff');res.send(x.rows[0].content)}));
 app.use('/api',r);
}
