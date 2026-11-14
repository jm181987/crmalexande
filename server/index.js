import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {query} from './db.js';
import {registerModuleRoutes} from './modules.js';
import {registerEvolutionInstances} from './evolution-instances.js';
const app=express(),secret=process.env.JWT_SECRET;
app.disable('x-powered-by');app.use(helmet({contentSecurityPolicy:false}));app.use('/api/webhooks/whatsapp',express.raw({type:'application/json',limit:'1mb'}));app.use(express.json({limit:'1mb'}));app.use(cookieParser());
if(process.env.APP_ORIGIN)app.use(cors({origin:process.env.APP_ORIGIN,credentials:true}));
const asyncRoute=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const valid=s=>typeof s==='string'&&s.trim().length>0;
const agent=u=>u.role==='agent';
const ownerSql=(u,column='owner_id',start=2)=>agent(u)?' AND '+column+'=$'+start:'';
const p=u=>agent(u)?[u.company_id,u.id]:[u.company_id];
const cookie={httpOnly:true,sameSite:'lax',secure:process.env.COOKIE_SECURE==='true',maxAge:28800000,path:'/'};
const auth=asyncRoute(async(req,res,next)=>{
 if(!secret)return res.status(503).json({error:'JWT_SECRET not configured'});
 try{
  const data=jwt.verify(req.cookies.crm_session,secret,{algorithms:['HS256']});
  const r=await query('SELECT id,company_id,name,email,role FROM users WHERE id=$1 AND is_active=true',[data.sub]);
  if(!r.rowCount)return res.status(401).json({error:'Unauthorized'});
  req.user=r.rows[0];next();
 }catch{return res.status(401).json({error:'Unauthorized'});}
});
const manager=(req,res,next)=>req.user.role==='owner'||req.user.role==='manager'?next():res.status(403).json({error:'Forbidden'});
const owner=(req,res,next)=>req.user.role==='owner'?next():res.status(403).json({error:'Forbidden'});
app.get('/api/health',asyncRoute(async(req,res)=>{await query('SELECT 1');res.json({status:'ok',database:'connected'});}));
app.post('/api/auth/login',asyncRoute(async(req,res)=>{
 if(!secret)return res.status(503).json({error:'Authentication not configured'});
 const {email,password}=req.body;if(!valid(email)||!valid(password))return res.status(400).json({error:'Email and password required'});
 const r=await query('SELECT * FROM users WHERE lower(email)=lower($1) AND is_active=true',[email.trim()]);
 if(!r.rowCount||!(await bcrypt.compare(password,r.rows[0].password_hash)))return res.status(401).json({error:'Invalid credentials'});
 const u=r.rows[0];res.cookie('crm_session',jwt.sign({sub:u.id},secret,{algorithm:'HS256',expiresIn:'8h'}),cookie);
 res.json({user:{id:u.id,name:u.name,email:u.email,role:u.role}});
}));
app.post('/api/auth/logout',(req,res)=>{res.clearCookie('crm_session',{path:'/',httpOnly:true,sameSite:'lax',secure:cookie.secure});res.json({ok:true});});
app.get('/api/auth/me',auth,(req,res)=>res.json({user:req.user}));
app.get('/api/dashboard',auth,asyncRoute(async(req,res)=>{
 const u=req.user,scope=ownerSql(u),q=p(u),[a,b,c,d,e]=await Promise.all([
 query('SELECT count(*)::int AS n FROM contacts WHERE company_id=$1'+scope,q),
 query("SELECT count(*)::int AS n,coalesce(sum(value),0)::float AS amount FROM opportunities WHERE company_id=$1 AND status='open'"+scope,q),
 query("SELECT coalesce(sum(value),0)::float AS amount FROM opportunities WHERE company_id=$1 AND status='won'"+scope,q),
 query('SELECT count(*)::int AS n FROM conversations WHERE company_id=$1'+ownerSql(u,'assignee_id'),q),
 query('SELECT count(*)::int AS n FROM tasks WHERE company_id=$1 AND completed=false'+scope,q)]);
 res.json({leads:a.rows[0].n,deals:b.rows[0],won:c.rows[0].amount,conversations:d.rows[0].n,pendingTasks:e.rows[0].n});
}));
app.get('/api/company',auth,asyncRoute(async(req,res)=>{
 const r=await query('SELECT id,name,created_at FROM companies WHERE id=$1',[req.user.company_id]);
 if(!r.rowCount)return res.status(404).json({error:'Company not found'});
 res.json(r.rows[0]);
}));
app.patch('/api/company',auth,owner,asyncRoute(async(req,res)=>{
 const {name}=req.body||{};
 if(typeof name!=='string'||!name.trim()||name.trim().length>120)return res.status(400).json({error:'Invalid company name'});
 const r=await query('UPDATE companies SET name=$2 WHERE id=$1 RETURNING id,name,created_at',[req.user.company_id,name.trim()]);
 res.json(r.rows[0]);
}));
app.get('/api/users',auth,asyncRoute(async(req,res)=>{const r=await query('SELECT id,name,email,role FROM users WHERE company_id=$1 AND is_active=true ORDER BY name',[req.user.company_id]);res.json(r.rows);}));
app.post('/api/users',auth,owner,asyncRoute(async(req,res)=>{
 const {name,email,password,role='agent'}=req.body;
 if(!valid(name)||!valid(email)||!valid(password)||password.length<12||!['owner','manager','agent'].includes(role))return res.status(400).json({error:'Invalid user'});
 const r=await query('INSERT INTO users(company_id,name,email,password_hash,role) VALUES($1,$2,lower($3),$4,$5) RETURNING id,name,email,role',[req.user.company_id,name.trim(),email.trim(),await bcrypt.hash(password,12),role]);res.status(201).json(r.rows[0]);
}));
app.get('/api/contacts',auth,asyncRoute(async(req,res)=>{
 const u=req.user,par=p(u),search=String(req.query.search||'').slice(0,100);
 const r=await query('SELECT * FROM contacts WHERE company_id=$1'+ownerSql(u)+' AND (name ILIKE $'+(par.length+1)+" OR coalesce(email,'') ILIKE $"+(par.length+1)+" OR coalesce(phone,'') ILIKE $"+(par.length+1)+') ORDER BY created_at DESC LIMIT 250',[...par,'%'+search+'%']);
 res.json(r.rows);
}));
app.post('/api/contacts',auth,asyncRoute(async(req,res)=>{
 const {name,email,phone,source,notes,tags=[],custom_fields={}}=req.body;
 if(!valid(name)||!Array.isArray(tags)||tags.length>30||typeof custom_fields!=='object'||custom_fields===null||Array.isArray(custom_fields))return res.status(400).json({error:'Invalid contact'});
 const r=await query('INSERT INTO contacts(company_id,owner_id,name,email,phone,source,notes,tags,custom_fields) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[req.user.company_id,req.user.id,name.trim(),email||null,phone||null,source||null,notes||null,tags.map(String),JSON.stringify(custom_fields)]);res.status(201).json(r.rows[0]);
}));
app.patch('/api/contacts/:id',auth,asyncRoute(async(req,res)=>{
 const allow=['name','email','phone','source','notes','tags','custom_fields'],keys=Object.keys(req.body).filter(k=>allow.includes(k));
 if(!keys.length||(keys.includes('name')&&!valid(req.body.name)))return res.status(400).json({error:'Invalid update'});
 const pars=[req.params.id,req.user.company_id,...(agent(req.user)?[req.user.id]:[])];
 const values=keys.map(k=>k==='custom_fields'?JSON.stringify(req.body[k]):req.body[k]);
 const sets=keys.map((k,i)=>k+'=$'+(pars.length+i+1)).join(',');
 const r=await query('UPDATE contacts SET '+sets+',updated_at=now() WHERE id=$1 AND company_id=$2'+ownerSql(req.user,'owner_id',3)+' RETURNING *',[...pars,...values]);
 if(!r.rowCount)return res.status(404).json({error:'Contact not found'});res.json(r.rows[0]);
}));
app.get('/api/pipelines',auth,asyncRoute(async(req,res)=>{
 const a=await query('SELECT * FROM pipelines WHERE company_id=$1 ORDER BY created_at',[req.user.company_id]);
 const b=await query('SELECT s.* FROM stages s JOIN pipelines p ON p.id=s.pipeline_id WHERE p.company_id=$1 ORDER BY s.position',[req.user.company_id]);res.json({pipelines:a.rows,stages:b.rows});
}));
app.post('/api/pipelines',auth,manager,asyncRoute(async(req,res)=>{
 if(!valid(req.body.name))return res.status(400).json({error:'Name required'});
 const r=await query('INSERT INTO pipelines(company_id,name) VALUES($1,$2) RETURNING *',[req.user.company_id,req.body.name.trim()]);
 for(const [i,name] of ['Novo Lead','Qualificação','Proposta','Vendido','Perdido'].entries())
 await query('INSERT INTO stages(pipeline_id,name,position,status) VALUES($1,$2,$3,$4)',[r.rows[0].id,name,i,i===3?'won':i===4?'lost':'open']);
 res.status(201).json(r.rows[0]);
}));
app.get('/api/opportunities',auth,asyncRoute(async(req,res)=>{
 const r=await query('SELECT o.*,c.name AS contact_name FROM opportunities o JOIN contacts c ON c.id=o.contact_id WHERE o.company_id=$1'+ownerSql(req.user,'o.owner_id')+' ORDER BY o.created_at DESC LIMIT 500',p(req.user));res.json(r.rows);
}));
app.post('/api/opportunities',auth,asyncRoute(async(req,res)=>{
 const {contact_id,pipeline_id,stage_id,title,value=0}=req.body;
 if(!valid(title)||!Number.isFinite(Number(value))||Number(value)<0)return res.status(400).json({error:'Invalid opportunity'});
 const par=p(req.user),contact=await query('SELECT id FROM contacts WHERE company_id=$1'+ownerSql(req.user)+' AND id=$'+(par.length+1),[...par,contact_id]);
 const stage=await query('SELECT s.status FROM stages s JOIN pipelines p ON p.id=s.pipeline_id WHERE s.id=$1 AND s.pipeline_id=$2 AND p.company_id=$3',[stage_id,pipeline_id,req.user.company_id]);
 if(!contact.rowCount||!stage.rowCount)return res.status(400).json({error:'Invalid contact or pipeline stage'});
 const r=await query('INSERT INTO opportunities(company_id,pipeline_id,stage_id,contact_id,owner_id,title,value,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[req.user.company_id,pipeline_id,stage_id,contact_id,req.user.id,title.trim(),value,stage.rows[0].status]);res.status(201).json(r.rows[0]);
}));
app.patch('/api/opportunities/:id/stage',auth,asyncRoute(async(req,res)=>{
 const {stage_id,lost_reason}=req.body;
 const stage=await query('SELECT s.status FROM stages s JOIN opportunities o ON o.pipeline_id=s.pipeline_id WHERE s.id=$1 AND o.id=$2 AND o.company_id=$3',[stage_id,req.params.id,req.user.company_id]);
 if(!stage.rowCount)return res.status(400).json({error:'Invalid stage'});
 const status=stage.rows[0].status;if(status==='lost'&&!valid(lost_reason))return res.status(400).json({error:'Loss reason required'});
 const args=[req.params.id,req.user.company_id,stage_id,status,status==='lost'?lost_reason:null,...(agent(req.user)?[req.user.id]:[])];
 const r=await query('UPDATE opportunities SET stage_id=$3,status=$4,lost_reason=$5,updated_at=now() WHERE id=$1 AND company_id=$2'+ownerSql(req.user,'owner_id',6)+' RETURNING *',args);
 if(!r.rowCount)return res.status(404).json({error:'Opportunity not found'});res.json(r.rows[0]);
}));
app.get('/api/conversations',auth,asyncRoute(async(req,res)=>{
 const r=await query('SELECT v.*,c.name AS contact_name,c.phone AS contact_phone,(SELECT body FROM messages m WHERE m.conversation_id=v.id ORDER BY created_at DESC LIMIT 1) AS last_message FROM conversations v JOIN contacts c ON c.id=v.contact_id WHERE v.company_id=$1'+ownerSql(req.user,'v.assignee_id')+' ORDER BY v.updated_at DESC LIMIT 200',p(req.user));res.json(r.rows);
}));
app.post('/api/conversations',auth,asyncRoute(async(req,res)=>{
 const par=p(req.user),contact=await query('SELECT id FROM contacts WHERE company_id=$1'+ownerSql(req.user)+' AND id=$'+(par.length+1),[...par,req.body.contact_id]);
 if(!contact.rowCount)return res.status(404).json({error:'Contact not found'});
 const r=await query('INSERT INTO conversations(company_id,contact_id,assignee_id,channel) VALUES($1,$2,$3,$4) RETURNING *',[req.user.company_id,req.body.contact_id,req.user.id,'internal']);res.status(201).json(r.rows[0]);
}));
app.get('/api/conversations/:id/messages',auth,asyncRoute(async(req,res)=>{
 const r=await query('SELECT m.*,u.name AS sender_name FROM messages m JOIN conversations v ON v.id=m.conversation_id LEFT JOIN users u ON u.id=m.sender_id WHERE v.id=$1 AND v.company_id=$2'+ownerSql(req.user,'v.assignee_id',3)+' ORDER BY m.created_at LIMIT 500',[req.params.id,req.user.company_id,...(agent(req.user)?[req.user.id]:[])]);res.json(r.rows);
}));
app.post('/api/conversations/:id/messages',auth,asyncRoute(async(req,res)=>{
 const {body,direction='internal'}=req.body;
 if(!valid(body)||body.length>10000||direction!=='internal')return res.status(400).json({error:'Only internal notes are supported'});
 const r=await query('SELECT id FROM conversations WHERE id=$1 AND company_id=$2'+ownerSql(req.user,'assignee_id',3),[req.params.id,req.user.company_id,...(agent(req.user)?[req.user.id]:[])]);
 if(!r.rowCount)return res.status(404).json({error:'Conversation not found'});
 const m=await query("INSERT INTO messages(conversation_id,sender_id,direction,body) VALUES($1,$2,'internal',$3) RETURNING *",[req.params.id,req.user.id,body.trim()]);
 await query('UPDATE conversations SET updated_at=now() WHERE id=$1',[req.params.id]);res.status(201).json(m.rows[0]);
}));
app.get('/api/tasks',auth,asyncRoute(async(req,res)=>{const r=await query('SELECT t.*,c.name AS contact_name FROM tasks t LEFT JOIN contacts c ON c.id=t.contact_id WHERE t.company_id=$1'+ownerSql(req.user,'t.owner_id')+' ORDER BY t.completed,t.due_at NULLS LAST LIMIT 250',p(req.user));res.json(r.rows);}));
app.post('/api/tasks',auth,asyncRoute(async(req,res)=>{
 const {title,contact_id,due_at}=req.body;if(!valid(title))return res.status(400).json({error:'Title required'});
 if(contact_id){const pa=p(req.user),c=await query('SELECT id FROM contacts WHERE company_id=$1'+ownerSql(req.user)+' AND id=$'+(pa.length+1),[...pa,contact_id]);if(!c.rowCount)return res.status(403).json({error:'Contact unavailable'});}
 const r=await query('INSERT INTO tasks(company_id,contact_id,owner_id,title,due_at) VALUES($1,$2,$3,$4,$5) RETURNING *',[req.user.company_id,contact_id||null,req.user.id,title.trim(),due_at||null]);res.status(201).json(r.rows[0]);
}));
app.patch('/api/tasks/:id',auth,asyncRoute(async(req,res)=>{
 const r=await query('UPDATE tasks SET completed=$3 WHERE id=$1 AND company_id=$2'+ownerSql(req.user,'owner_id',4)+' RETURNING *',[req.params.id,req.user.company_id,req.body.completed===true,...(agent(req.user)?[req.user.id]:[])]);
 if(!r.rowCount)return res.status(404).json({error:'Task not found'});res.json(r.rows[0]);
}));
app.get('/api/appointments',auth,asyncRoute(async(req,res)=>{const r=await query('SELECT a.*,c.name AS contact_name FROM appointments a LEFT JOIN contacts c ON c.id=a.contact_id WHERE a.company_id=$1'+ownerSql(req.user,'a.owner_id')+' ORDER BY a.start_at LIMIT 250',p(req.user));res.json(r.rows);}));
app.post('/api/appointments',auth,asyncRoute(async(req,res)=>{
 const {title,contact_id,start_at,end_at}=req.body;if(!valid(title)||!start_at||!end_at||!Number.isFinite(Date.parse(start_at))||!Number.isFinite(Date.parse(end_at))||new Date(start_at)>=new Date(end_at))return res.status(400).json({error:'Invalid appointment'});
 if(contact_id){const pa=p(req.user),c=await query('SELECT id FROM contacts WHERE company_id=$1'+ownerSql(req.user)+' AND id=$'+(pa.length+1),[...pa,contact_id]);if(!c.rowCount)return res.status(403).json({error:'Contact unavailable'});}
 const conflict=await query("SELECT id FROM appointments WHERE company_id=$1 AND owner_id=$2 AND status='scheduled' AND start_at<$4 AND end_at>$3 LIMIT 1",[req.user.company_id,req.user.id,start_at,end_at]);if(conflict.rowCount)return res.status(409).json({error:'Time conflict'});
 const r=await query('INSERT INTO appointments(company_id,contact_id,owner_id,title,start_at,end_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[req.user.company_id,contact_id||null,req.user.id,title.trim(),start_at,end_at]);res.status(201).json(r.rows[0]);
}));
registerModuleRoutes(app,auth);
registerEvolutionInstances(app,auth);
app.use('/api',(req,res)=>res.status(404).json({error:'API route not found'}));
if(process.env.NODE_ENV==='production'){
 const dist=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../dist');
 app.use(express.static(dist));app.get('*',(req,res)=>res.sendFile(path.join(dist,'index.html')));
}
app.use((e,req,res,next)=>{console.error('API error',e.code||e.message);if(e.code==='23505')return res.status(409).json({error:'Duplicate record'});if(['22P02','23503','22007'].includes(e.code))return res.status(400).json({error:'Invalid input'});res.status(500).json({error:'Internal server error'});});
if(!secret)console.warn('Set JWT_SECRET before enabling authentication');
if (process.env.VERCEL !== '1') app.listen(Number(process.env.PORT||3001),'0.0.0.0',()=>console.log('Alexandre CRM server started'));
export default app;
