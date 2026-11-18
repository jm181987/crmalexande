import {Router} from 'express';
import {query} from './db.js';
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const uuid=s=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const mimeAllowed=['image/jpeg','image/png','image/webp','image/gif'];
const validImage=(bytes,mime)=>mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:mime==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):mime==='image/gif'?['GIF87a','GIF89a'].includes(bytes.toString('ascii',0,6)):bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
export function registerEmailImageRoutes(app,auth){
 const r=Router();
 r.get('/public/email-image/:id',wrap(async(req,res)=>{
  if(!uuid(req.params.id))return res.sendStatus(404);
  const x=await query('SELECT mime,content FROM public.crm_email_images WHERE id=$1',[req.params.id]);
  if(!x.rowCount)return res.sendStatus(404);
  res.set({'Content-Type':x.rows[0].mime,'Cache-Control':'public, max-age=86400','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"});
  res.send(x.rows[0].content);
 }));
 r.post('/email-images/upload',auth,wrap(async(req,res)=>{
  if(!['owner','manager'].includes(req.user.role))return res.sendStatus(403);
  const {mime,data}=req.body||{};
  if(!mimeAllowed.includes(mime)||typeof data!=='string'||data.length>2900000||!/^[A-Za-z0-9+/]+={0,2}$/.test(data))return res.status(400).json({error:'Usá JPG, PNG, WebP o GIF de hasta 2 MB'});
  const bytes=Buffer.from(data,'base64');
  if(bytes.length<32||bytes.length>2097152||!validImage(bytes,mime))return res.status(400).json({error:'Archivo de imagen inválido o demasiado grande'});
  const x=await query('INSERT INTO public.crm_email_images(company_id,uploaded_by,mime,content) VALUES($1,$2,$3,$4) RETURNING id',[req.user.company_id,req.user.id,mime,bytes]);
  res.status(201).json({id:x.rows[0].id,path:'/api/public/email-image/'+x.rows[0].id});
 }));
 r.get('/email-images',auth,wrap(async(req,res)=>{
  if(!['owner','manager'].includes(req.user.role))return res.sendStatus(403);
  const x=await query('SELECT id,mime,created_at FROM public.crm_email_images WHERE company_id=$1 ORDER BY created_at DESC LIMIT 80',[req.user.company_id]);
  res.json(x.rows.map(row=>({...row,path:'/api/public/email-image/'+row.id})));
 }));
 app.use('/api',r);
}
