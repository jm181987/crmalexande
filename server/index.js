import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {query,pool,tenantContext} from './db.js';
import {registerBranding} from './branding.js';
import {registerModuleRoutes} from './modules.js';
import {registerAiReceptionRoutes} from './ai-reception.js';
import {registerInventoryRoutes} from './inventory.js';
import {registerEvolutionInstances} from './evolution-instances.js';
import {registerCampaignDelivery} from './campaign-delivery.js';
import {dispatchCampaignBatch} from './campaign-worker.js';
import {registerUnsubscribe} from './campaign-unsubscribe.js';
import {registerSendgridEvents} from './sendgrid-events.js';
import {runFollowupAutomations} from './followup-automation.js';
import {startAutomationScheduler} from './automation-scheduler.js';
import {timingSafeEqual} from 'node:crypto';
import {isValidUserEmail} from './user-validation.js';
const app=express(),secret=process.env.JWT_SECRET;
app.disable('x-powered-by');app.use(helmet({contentSecurityPolicy:false}));app.use('/api/webhooks/whatsapp',express.raw({type:'application/json',limit:'1mb'}));registerSendgridEvents(app);app.use('/api/inventory-images/upload',express.json({limit:'4mb'}));app.use(/^\/api\/conversations\/[^/]+\/evolution-media$/,express.json({limit:'12mb'}));app.use(express.json({limit:'1mb'}));app.use(cookieParser());
if(process.env.APP_ORIGIN)app.use(cors({origin:process.env.APP_ORIGIN,credentials:true}));
const asyncRoute=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const valid=s=>typeof s==='string'&&s.trim().length>0;
const agent=u=>u.role==='agent';
const ownerSql=(u,column='owner_id',start=2)=>agent(u)?' AND '+column+'=$'+start:'';
const p=u=>agent(u)?[u.company_id,u.id]:[u.company_id];
const cookie={httpOnly:true,sameSite:'lax',secure:process.env.COOKIE_SECURE==='true',maxAge:28800000,path:'/'};
const auth=asyncRoute(async(req,res,next)=>{
 if(!secret)return res.status(503).json({error:'Authentication not configured'});
 const token=req.cookies?.crm_session;
 if(!token)return res.status(401).json({error:'Session required',code:'SESSION_REQUIRED'});
 let data;
 try{data=jwt.verify(token,secret,{algorithms:['HS256']});}
 catch(err){return res.status(401).json({error:err.name==='TokenExpiredError'?'Session expired':'Invalid session',code:err.name==='TokenExpiredError'?'SESSION_EXPIRED':'INVALID_SESSION'});}
 // Database failures must not be reported as invalid credentials.
 const r=process.env.TENANT_RLS_ENABLED==='true'?await query('SELECT * FROM public.crm_auth_user_by_id($1)',[data.sub]):await query('SELECT id,company_id,name,email,role FROM users WHERE id=$1 AND is_active=true',[data.sub]);
 if(!r.rowCount)return res.status(401).json({error:'User account unavailable',code:'ACCOUNT_UNAVAILABLE'});
 req.user=r.rows[0];
 if(data.supportCompanyId){
  const platform=await pool.query('SELECT 1 FROM public.crm_platform_admins WHERE user_id=$1',[req.user.id]);
  if(!platform.rowCount)return res.status(403).json({error:'Support access revoked'});
  const company=await pool.query('SELECT id FROM public.companies WHERE id=$1',[data.supportCompanyId]);
  if(!company.rowCount)return res.status(403).json({error:'Support company unavailable'});
  req.user={...req.user,company_id:data.supportCompanyId,role:'owner',support_mode:true,home_company_id:r.rows[0].company_id};
 }
 // Entitlements are enforced on the server, not merely hidden in navigation.
 const toolFromPath=(p)=>{
  if(/^\/api\/evolution\//.test(p))return 'evolution';
  if(/^\/api\/inventory(?:\/|$)|^\/api\/inventory-images\//.test(p))return 'inventory';
  for(const key of ['conversations','opportunities','contacts','calendar','tasks','ai','automation','campaigns','reviews','reports'])
   if(p==='/api/'+key||p.startsWith('/api/'+key+'/'))return key;
  return null;
 };
 const tool=toolFromPath(req.path);
 if(tool){
  const access=await query('SELECT enabled FROM public.crm_company_tools WHERE company_id=$1 AND tool_key=$2',[req.user.company_id,tool]);
  if(access.rowCount&&!access.rows[0].enabled)return res.status(403).json({error:'Tool disabled for this company',code:'TOOL_DISABLED',tool});
 }
 tenantContext.enterWith({companyId:req.user.company_id});next();
});
const manager=(req,res,next)=>req.user.role==='owner'||req.user.role==='manager'?next():res.status(403).json({error:'Forbidden'});
const owner=(req,res,next)=>req.user.role==='owner'?next():res.status(403).json({error:'Forbidden'});
// Worker is disabled by default. Configure a private scheduler with a long bearer secret.
app.post('/api/internal/automation-run',asyncRoute(async(req,res)=>{
 const expected=process.env.CAMPAIGN_WORKER_SECRET||'',provided=String(req.headers.authorization||'').replace(/^Bearer /,'');
 if(expected.length<24||provided.length!==expected.length||!timingSafeEqual(Buffer.from(provided),Buffer.from(expected)))return res.sendStatus(401);
 res.json(await runFollowupAutomations({limit:50}));
}));
app.post('/api/internal/campaign-dispatch',asyncRoute(async(req,res)=>{
 const expected=process.env.CAMPAIGN_WORKER_SECRET||'',provided=String(req.headers.authorization||'').replace(/^Bearer /,'');
 if(expected.length<24||provided.length!==expected.length||!timingSafeEqual(Buffer.from(provided),Buffer.from(expected)))return res.sendStatus(401);
 const result=await dispatchCampaignBatch({limit:10});res.json(result);
}));
app.get('/api/health',asyncRoute(async(req,res)=>{await query('SELECT 1');res.json({status:'ok',database:'connected'});}));
app.post('/api/auth/login',asyncRoute(async(req,res)=>{
 if(!secret)return res.status(503).json({error:'Authentication not configured'});
 const {email,password}=req.body;if(!valid(email)||!valid(password))return res.status(400).json({error:'Email and password required'});
 const r=process.env.TENANT_RLS_ENABLED==='true'?await query('SELECT * FROM public.crm_auth_user_by_email($1)',[email.trim()]):await query('SELECT * FROM users WHERE lower(email)=lower($1) AND is_active=true',[email.trim()]);
 if(!r.rowCount||!(await bcrypt.compare(password,r.rows[0].password_hash)))return res.status(401).json({error:'Invalid credentials'});
 const u=r.rows[0];res.cookie('crm_session',jwt.sign({sub:u.id},secret,{algorithm:'HS256',expiresIn:'8h'}),cookie);
 res.json({user:{id:u.id,name:u.name,email:u.email,role:u.role}});
}));
app.post('/api/auth/logout',(req,res)=>{res.clearCookie('crm_session',{path:'/',httpOnly:true,sameSite:'lax',secure:cookie.secure});res.json({ok:true});});
const platformAdmin=asyncRoute(async(req,res,next)=>{
 const r=await pool.query('SELECT 1 FROM public.crm_platform_admins a JOIN public.users u ON u.id=a.user_id WHERE a.user_id=$1 AND u.is_active=true',[req.user.id]);
 if(!r.rowCount)return res.status(403).json({error:'Platform administrator access required'});
 next();
});
const TOOL_KEYS=['inventory','conversations','opportunities','contacts','calendar','tasks','ai','automation','campaigns','reviews','reports','evolution'];
app.get('/api/platform/companies',auth,platformAdmin,asyncRoute(async(req,res)=>{
 const companies=await pool.query('SELECT id,name,created_at FROM public.companies ORDER BY name');
 const rows=await pool.query('SELECT company_id,tool_key,enabled FROM public.crm_company_tools');
 res.json(companies.rows.map(c=>({...c,tools:Object.fromEntries(TOOL_KEYS.map(k=>[k,rows.rows.find(t=>t.company_id===c.id&&t.tool_key===k)?.enabled??true]))})));
}));
app.put('/api/platform/companies/:id/tools/:tool',auth,platformAdmin,asyncRoute(async(req,res)=>{
 const {id,tool}=req.params;
 if(!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id)||!TOOL_KEYS.includes(tool)||typeof req.body?.enabled!=='boolean')return res.status(400).json({error:'Invalid company, tool or enabled value'});
 const c=await pool.query('SELECT id FROM public.companies WHERE id=$1',[id]);if(!c.rowCount)return res.sendStatus(404);
 const result=await pool.query('INSERT INTO public.crm_company_tools(company_id,tool_key,enabled,updated_by) VALUES($1,$2,$3,$4) ON CONFLICT(company_id,tool_key) DO UPDATE SET enabled=excluded.enabled,updated_by=excluded.updated_by,updated_at=now() RETURNING company_id,tool_key,enabled',[id,tool,req.body.enabled,req.user.id]);
 res.json(result.rows[0]);
}));
const validUuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
app.post('/api/platform/companies',auth,platformAdmin,asyncRoute(async(req,res)=>{
 const name=req.body?.name;
 if(typeof name!=='string'||!name.trim()||name.trim().length>120)return res.status(400).json({error:'Invalid company name'});
 const c=await pool.query('INSERT INTO public.companies(name) VALUES($1) RETURNING id,name,created_at',[name.trim()]);
 res.status(201).json(c.rows[0]);
}));
app.patch('/api/platform/companies/:id',auth,platformAdmin,asyncRoute(async(req,res)=>{
 if(!validUuid(req.params.id)||typeof req.body?.name!=='string'||!req.body.name.trim()||req.body.name.trim().length>120)return res.sendStatus(400);
 const r=await pool.query('UPDATE public.companies SET name=$2 WHERE id=$1 RETURNING id,name',[req.params.id,req.body.name.trim()]);
 if(!r.rowCount)return res.sendStatus(404);res.json(r.rows[0]);
}));
app.get('/api/platform/companies/:id/users',auth,platformAdmin,asyncRoute(async(req,res)=>{
 if(!validUuid(req.params.id))return res.sendStatus(400);
 const r=await pool.query('SELECT id,name,email,role,is_active FROM public.users WHERE company_id=$1 ORDER BY name',[req.params.id]);res.json(r.rows);
}));
app.post('/api/platform/companies/:id/users',auth,platformAdmin,asyncRoute(async(req,res)=>{
 const {name,email,password,role='agent'}=req.body||{};
 if(!validUuid(req.params.id)||!valid(name)||name.trim().length>120||!valid(email)||!isValidUserEmail(email)||typeof password!=='string'||password.length<12||!['owner','manager','agent'].includes(role))return res.status(400).json({error:'Invalid user details or password under 12 characters'});
 const company=await pool.query('SELECT id FROM public.companies WHERE id=$1',[req.params.id]);if(!company.rowCount)return res.sendStatus(404);
 const r=await pool.query('INSERT INTO public.users(company_id,name,email,password_hash,role) VALUES($1,$2,lower($3),$4,$5) RETURNING id,name,email,role',[req.params.id,name.trim(),email.trim(),await bcrypt.hash(password,12),role]);res.status(201).json(r.rows[0]);
}));
app.patch('/api/platform/companies/:id/users/:userId',auth,platformAdmin,asyncRoute(async(req,res)=>{
 const {name,email,role,is_active,password}=req.body||{};
 if(!validUuid(req.params.id)||!validUuid(req.params.userId)||name!==undefined&&(!valid(name)||name.length>120)||email!==undefined&&(!valid(email)||!isValidUserEmail(email))||role!==undefined&&!['owner','manager','agent'].includes(role)||is_active!==undefined&&typeof is_active!=='boolean'||password!==undefined&&(typeof password!=='string'||password.length<12))return res.sendStatus(400);
 const current=await pool.query('SELECT id,role,is_active FROM public.users WHERE id=$1 AND company_id=$2',[req.params.userId,req.params.id]);if(!current.rowCount)return res.sendStatus(404);
 if(current.rows[0].role==='owner'&&(role&&role!=='owner'||is_active===false)){
  const n=await pool.query("SELECT count(*)::int AS n FROM public.users WHERE company_id=$1 AND role='owner' AND is_active=true",[req.params.id]);
  if(n.rows[0].n<=1)return res.status(409).json({error:'Cannot remove the last active owner'});
 }
 const r=await pool.query('UPDATE public.users SET name=COALESCE($3,name),email=COALESCE(lower($4),email),role=COALESCE($5,role),is_active=COALESCE($6,is_active),password_hash=COALESCE($7,password_hash) WHERE id=$1 AND company_id=$2 RETURNING id,name,email,role,is_active',[req.params.userId,req.params.id,name??null,email??null,role??null,is_active??null,password?await bcrypt.hash(password,12):null]);res.json(r.rows[0]);
}));
app.post('/api/platform/support/:id/start',auth,platformAdmin,asyncRoute(async(req,res)=>{
 if(!validUuid(req.params.id))return res.sendStatus(400);
 const c=await pool.query('SELECT id,name FROM public.companies WHERE id=$1',[req.params.id]);if(!c.rowCount)return res.sendStatus(404);
 await pool.query('INSERT INTO public.crm_platform_support_audit(admin_user_id,company_id,action) VALUES($1,$2,$3)',[req.user.id,req.params.id,'start']);
 res.cookie('crm_session',jwt.sign({sub:req.user.id,supportCompanyId:req.params.id},secret,{algorithm:'HS256',expiresIn:'2h'}),cookie);
 res.json({company:c.rows[0]});
}));
app.post('/api/platform/support/end',auth,platformAdmin,asyncRoute(async(req,res)=>{
 if(req.user.support_mode)await pool.query('INSERT INTO public.crm_platform_support_audit(admin_user_id,company_id,action) VALUES($1,$2,$3)',[req.user.id,req.user.company_id,'end']);
 res.cookie('crm_session',jwt.sign({sub:req.user.id},secret,{algorithm:'HS256',expiresIn:'8h'}),cookie);res.json({ok:true});
}));
app.get('/api/company/tools',auth,asyncRoute(async(req,res)=>{
 const r=await query('SELECT tool_key,enabled FROM public.crm_company_tools WHERE company_id=$1',[req.user.company_id]);
 res.json(Object.fromEntries(TOOL_KEYS.map(k=>[k,r.rows.find(x=>x.tool_key===k)?.enabled??true])));
}));
app.get('/api/platform/me',auth,asyncRoute(async(req,res)=>{
 const r=await pool.query('SELECT 1 FROM public.crm_platform_admins WHERE user_id=$1',[req.user.id]);
 res.json({platform_admin:!!r.rowCount});
}));
app.get('/api/auth/me',auth,(req,res)=>res.json({user:req.user}));
app.get('/api/dashboard',auth,asyncRoute(async(req,res)=>{
 const u=req.user,scope=ownerSql(u),q=p(u),[a,b,c,d,e]=await Promise.all([
 query('SELECT count(*)::int AS n FROM contacts WHERE company_id=$1'+scope,q),
 query("SELECT count(*)::int AS n,coalesce(sum(value),0)::float AS amount FROM opportunities WHERE company_id=$1 AND deleted_at IS NULL AND status='open'"+scope,q),
 query("SELECT coalesce(sum(value),0)::float AS amount FROM opportunities WHERE company_id=$1 AND deleted_at IS NULL AND status='won'"+scope,q),
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
 const {name,email,password,role='agent'}=req.body||{};
 if(!valid(name)||name.trim().length>120)return res.status(400).json({error:'Ingresá un nombre válido (máximo 120 caracteres)'});
 if(!valid(email)||email.trim().length>254||!isValidUserEmail(email))return res.status(400).json({error:'Ingresá un correo electrónico válido'});
 if(typeof password!=='string'||password.length<12)return res.status(400).json({error:'La contraseña debe tener al menos 12 caracteres'});
 if(!['owner','manager','agent'].includes(role))return res.status(400).json({error:'Seleccioná un rol válido: usuario, manager u owner'});
 const r=await query('INSERT INTO users(company_id,name,email,password_hash,role) VALUES($1,$2,lower($3),$4,$5) RETURNING id,name,email,role',[req.user.company_id,name.trim(),email.trim(),await bcrypt.hash(password,12),role]);res.status(201).json(r.rows[0]);
}));
app.patch('/api/users/:id',auth,owner,asyncRoute(async(req,res)=>{
 const {name,email,role,password}=req.body||{};
 if((name!==undefined&&(!valid(name)||name.length>120))||(email!==undefined&&(!valid(email)||email.length>254))||(role!==undefined&&!['owner','manager','agent'].includes(role))||(password!==undefined&&(typeof password!=='string'||password.length<12)))return res.status(400).json({error:'Datos inválidos; contraseña mínima de 12 caracteres'});
 const current=await query('SELECT id,role FROM users WHERE id=$1 AND company_id=$2 AND is_active=true',[req.params.id,req.user.company_id]);
 if(!current.rowCount)return res.sendStatus(404);
 if(current.rows[0].role==='owner'&&role&&role!=='owner'){
  const count=await query("SELECT count(*)::int AS n FROM users WHERE company_id=$1 AND role='owner' AND is_active=true",[req.user.company_id]);
  if(count.rows[0].n<=1)return res.status(409).json({error:'No se puede quitar el último owner'});
  if(req.params.id===String(req.user.id))return res.status(409).json({error:'No podés quitarte tu propio rol owner'});
 }
 const hash=password?await bcrypt.hash(password,12):null;
 const x=await query('UPDATE users SET name=COALESCE($3,name),email=COALESCE(lower($4),email),role=COALESCE($5,role),password_hash=COALESCE($6,password_hash) WHERE id=$1 AND company_id=$2 AND is_active=true RETURNING id,name,email,role',[req.params.id,req.user.company_id,name?.trim()||null,email?.trim()||null,role||null,hash]);
 res.json(x.rows[0]);
}));
app.delete('/api/users/:id',auth,owner,asyncRoute(async(req,res)=>{
 if(req.params.id===String(req.user.id))return res.status(409).json({error:'No podés desactivar tu propia cuenta'});
 const x=await query("UPDATE users SET is_active=false WHERE id=$1 AND company_id=$2 AND is_active=true AND role<>'owner' RETURNING id",[req.params.id,req.user.company_id]);
 if(!x.rowCount)return res.status(409).json({error:'Usuario inexistente o owner; cambiá primero su rol'});
 res.json({deactivated:true});
}));
// Saved contact segments, scoped to the authenticated company.
app.get('/api/smart-lists',auth,asyncRoute(async(req,res)=>{
 const r=await query('SELECT id,name,filters,created_at FROM crm_smart_lists WHERE company_id=$1 ORDER BY name',[req.user.company_id]);res.json(r.rows);
}));
app.post('/api/smart-lists',auth,manager,asyncRoute(async(req,res)=>{
 const name=String(req.body?.name||'').trim(),filters=req.body?.filters;
 if(!name||name.length>100||!filters||typeof filters!=='object'||Array.isArray(filters)||Object.keys(filters).some(k=>!['tag','source'].includes(k))||Object.values(filters).some(v=>typeof v!=='string'||v.length>100))return res.status(400).json({error:'Invalid smart list'});
 const r=await query('INSERT INTO crm_smart_lists(company_id,name,filters,created_by) VALUES($1,$2,$3,$4) RETURNING id,name,filters',[req.user.company_id,name,JSON.stringify(filters),req.user.id]);res.status(201).json(r.rows[0]);
}));
app.delete('/api/smart-lists/:id',auth,manager,asyncRoute(async(req,res)=>{
 const r=await query('DELETE FROM crm_smart_lists WHERE id=$1 AND company_id=$2 RETURNING id',[req.params.id,req.user.company_id]);if(!r.rowCount)return res.sendStatus(404);res.json({ok:true});
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
// Tenant-scoped stage customization; status determines reporting semantics.
app.post('/api/pipelines/:pipelineId/stages',auth,manager,asyncRoute(async(req,res)=>{
 const name=String(req.body?.name||'').trim(),status=req.body?.status||'open';
 if(!name||name.length>100||!['open','won','lost','abandoned'].includes(status))return res.status(400).json({error:'Invalid stage'});
 const p=await query('SELECT id FROM pipelines WHERE id=$1 AND company_id=$2',[req.params.pipelineId,req.user.company_id]);
 if(!p.rowCount)return res.sendStatus(404);
 const r=await query('INSERT INTO stages(pipeline_id,name,position,status) VALUES($1,$2,(SELECT COALESCE(MAX(position),-1)+1 FROM stages WHERE pipeline_id=$1),$3) RETURNING *',[req.params.pipelineId,name,status]);
 res.status(201).json(r.rows[0]);
}));
app.patch('/api/pipelines/:pipelineId/stages/:stageId',auth,manager,asyncRoute(async(req,res)=>{
 const name=String(req.body?.name||'').trim();
 if(!name||name.length>100)return res.status(400).json({error:'Invalid stage name'});
 const r=await query('UPDATE stages s SET name=$4 FROM pipelines p WHERE s.id=$1 AND s.pipeline_id=$2 AND p.id=s.pipeline_id AND p.company_id=$3 RETURNING s.*',[req.params.stageId,req.params.pipelineId,req.user.company_id,name]);
 if(!r.rowCount)return res.sendStatus(404);
 res.json(r.rows[0]);
}));
app.get('/api/opportunities',auth,asyncRoute(async(req,res)=>{
 const r=await query('SELECT o.*,c.name AS contact_name,c.phone AS contact_phone,c.email AS contact_email,c.source AS contact_source,c.tags AS contact_tags,c.notes AS contact_notes FROM opportunities o JOIN contacts c ON c.id=o.contact_id WHERE o.company_id=$1 AND o.deleted_at IS NULL'+ownerSql(req.user,'o.owner_id')+' ORDER BY o.created_at DESC LIMIT 500',p(req.user));res.json(r.rows);
}));
// Bulk add existing contacts to a pipeline stage; never duplicate a contact or an existing deal in that pipeline.
app.post('/api/opportunities/bulk-from-contacts',auth,asyncRoute(async(req,res)=>{
 const {contact_ids,pipeline_id,stage_id}=req.body||{};
 if(!Array.isArray(contact_ids)||!contact_ids.length||contact_ids.length>100||contact_ids.some(id=>typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id))||new Set(contact_ids).size!==contact_ids.length)return res.status(400).json({error:'Select between 1 and 100 unique contacts'});
 const stage=await query('SELECT s.status FROM stages s JOIN pipelines p ON p.id=s.pipeline_id WHERE s.id=$1 AND s.pipeline_id=$2 AND p.company_id=$3',[stage_id,pipeline_id,req.user.company_id]);
 if(!stage.rowCount)return res.status(400).json({error:'Invalid pipeline stage'});
 const args=[req.user.company_id,pipeline_id,stage_id,req.user.id,stage.rows[0].status,contact_ids];
 const scope=agent(req.user)?' AND c.owner_id=$4':'';
 const sql=`INSERT INTO opportunities(company_id,pipeline_id,stage_id,contact_id,owner_id,title,value,status)
 SELECT $1,$2,$3,c.id,$4,c.name,0,$5 FROM contacts c
 WHERE c.company_id=$1 AND c.id=ANY($6::uuid[])${scope}
 AND NOT EXISTS(SELECT 1 FROM opportunities o WHERE o.company_id=$1 AND o.pipeline_id=$2 AND o.contact_id=c.id AND o.deleted_at IS NULL)
 RETURNING id,contact_id`;
 const result=await query(sql,args);
 res.status(201).json({created:result.rowCount,skipped:contact_ids.length-result.rowCount,contact_ids:result.rows.map(x=>x.contact_id)});
}));
app.post('/api/opportunities',auth,asyncRoute(async(req,res)=>{
 const {contact_id,pipeline_id,stage_id,title,value=0}=req.body;
 if(!valid(title)||!Number.isFinite(Number(value))||Number(value)<0)return res.status(400).json({error:'Invalid opportunity'});
 const par=p(req.user),contact=await query('SELECT id FROM contacts WHERE company_id=$1'+ownerSql(req.user)+' AND id=$'+(par.length+1),[...par,contact_id]);
 const stage=await query('SELECT s.status FROM stages s JOIN pipelines p ON p.id=s.pipeline_id WHERE s.id=$1 AND s.pipeline_id=$2 AND p.company_id=$3',[stage_id,pipeline_id,req.user.company_id]);
 if(!contact.rowCount||!stage.rowCount)return res.status(400).json({error:'Invalid contact or pipeline stage'});
 const r=await query('INSERT INTO opportunities(company_id,pipeline_id,stage_id,contact_id,owner_id,title,value,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[req.user.company_id,pipeline_id,stage_id,contact_id,req.user.id,title.trim(),value,stage.rows[0].status]);res.status(201).json(r.rows[0]);
}));
app.patch('/api/opportunities/:id',auth,asyncRoute(async(req,res)=>{
 const {title,value,contact_id}=req.body||{};
 if(!valid(title)||title.trim().length>200||!Number.isFinite(Number(value))||Number(value)<0||Number(value)>999999999999)return res.status(400).json({error:'Invalid opportunity'});
 const contact=await query('SELECT id FROM contacts WHERE company_id=$1 AND id=$2',[req.user.company_id,contact_id]);if(!contact.rowCount)return res.status(400).json({error:'Invalid contact'});
 const r=await query('UPDATE opportunities SET title=$3,value=$4,contact_id=$5,updated_at=now() WHERE id=$1 AND company_id=$2 AND deleted_at IS NULL'+ownerSql(req.user,'owner_id',6)+' RETURNING *',[req.params.id,req.user.company_id,title.trim(),Number(value),contact_id,...(agent(req.user)?[req.user.id]:[])]);
 if(!r.rowCount)return res.sendStatus(404);res.json(r.rows[0]);
}));
app.delete('/api/opportunities/:id',auth,asyncRoute(async(req,res)=>{
 const r=await query('UPDATE opportunities SET deleted_at=now(),updated_at=now() WHERE id=$1 AND company_id=$2 AND deleted_at IS NULL'+ownerSql(req.user,'owner_id',3)+' RETURNING id',[req.params.id,req.user.company_id,...(agent(req.user)?[req.user.id]:[])]);
 if(!r.rowCount)return res.sendStatus(404);res.json({ok:true});
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
 const r=await query('SELECT v.*,c.name AS contact_name,c.phone AS contact_phone,u.name AS assignee_name,(SELECT body FROM messages m WHERE m.conversation_id=v.id ORDER BY created_at DESC LIMIT 1) AS last_message FROM conversations v JOIN contacts c ON c.id=v.contact_id LEFT JOIN users u ON u.id=v.assignee_id WHERE v.company_id=$1'+ownerSql(req.user,'v.assignee_id')+' ORDER BY v.updated_at DESC LIMIT 200',p(req.user));res.json(r.rows);
}));
// Inbox assignment: managers can assign any active agent in their company.
// Opt-in Round Robin configuration, owner/manager only.
app.get('/api/round-robin',auth,manager,asyncRoute(async(req,res)=>{
 const r=await query('SELECT enabled,last_assignee_id,updated_at FROM crm_round_robin_settings WHERE company_id=$1',[req.user.company_id]);
 res.json(r.rows[0]||{enabled:false,last_assignee_id:null});
}));
app.put('/api/round-robin',auth,manager,asyncRoute(async(req,res)=>{
 if(typeof req.body?.enabled!=='boolean')return res.status(400).json({error:'Invalid setting'});
 const r=await query('INSERT INTO crm_round_robin_settings(company_id,enabled) VALUES($1,$2) ON CONFLICT(company_id) DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=now() RETURNING enabled,last_assignee_id,updated_at',[req.user.company_id,req.body.enabled]);
 res.json(r.rows[0]);
}));
app.get('/api/conversations/agents',auth,asyncRoute(async(req,res)=>{
 const r=await query("SELECT id,name,role FROM users WHERE company_id=$1 AND is_active=true ORDER BY name",[req.user.company_id]);
 res.json(r.rows);
}));
app.patch('/api/conversations/:id/assign',auth,manager,asyncRoute(async(req,res)=>{
 const assignee=req.body?.assignee_id;
 if(assignee!==null&&typeof assignee!=='string')return res.status(400).json({error:'Invalid assignee'});
 if(assignee){
  const u=await query('SELECT id FROM users WHERE id=$1 AND company_id=$2 AND is_active=true',[assignee,req.user.company_id]);
  if(!u.rowCount)return res.status(400).json({error:'Agent unavailable'});
 }
 const r=await query('UPDATE conversations SET assignee_id=$3,updated_at=now() WHERE id=$1 AND company_id=$2 RETURNING *',[req.params.id,req.user.company_id,assignee||null]);
 if(!r.rowCount)return res.sendStatus(404);
 res.json(r.rows[0]);
}));
app.post('/api/conversations/:id/read',auth,asyncRoute(async(req,res)=>{
 const r=await query('UPDATE conversations SET unread_count=0 WHERE id=$1 AND company_id=$2'+ownerSql(req.user,'assignee_id',3)+' RETURNING id,unread_count',[req.params.id,req.user.company_id,...(agent(req.user)?[req.user.id]:[])]);
 if(!r.rowCount)return res.sendStatus(404);
 res.json(r.rows[0]);
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
registerBranding(app,auth,owner);
registerEvolutionInstances(app,auth);
registerUnsubscribe(app);
registerCampaignDelivery(app,auth);
registerModuleRoutes(app,auth);
registerAiReceptionRoutes(app,auth);
registerInventoryRoutes(app,auth);
app.use('/api',(req,res)=>res.status(404).json({error:'API route not found'}));
if(process.env.NODE_ENV==='production'){
 const dist=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../dist');
 app.use(express.static(dist));app.get('*',(req,res)=>res.sendFile(path.join(dist,'index.html')));
}
app.use((e,req,res,next)=>{console.error('API error',e.code||e.message);if(e.code==='23505')return res.status(409).json({error:'Duplicate record'});if(['22P02','23503','22007'].includes(e.code))return res.status(400).json({error:'Invalid input'});res.status(500).json({error:'Internal server error'});});
if(!secret)console.warn('Set JWT_SECRET before enabling authentication');
if (process.env.VERCEL !== '1') app.listen(Number(process.env.PORT||3001),'0.0.0.0',()=>{console.log('Alexandre CRM server started');startAutomationScheduler()});
export default app;
