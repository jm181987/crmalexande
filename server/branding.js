import {query} from './db.js';
const defaults={name:'ZARKO | CRM & Inteligência Comercial',logo:null};
const normalizeName=value=>String(value||defaults.name).trim().replace(/^(?:ZARKO\s*[|—–-]\s*)+ZARKO\b/i,'ZARKO').replace(/^(ZARKO)(?:\s*[|—–-]\s*ZARKO)+\b/i,'$1');
const sanitize=row=>({name:normalizeName(row?.name),logo:row?.logo||null});
export function registerBranding(app,auth,owner){
 app.get('/api/public/branding',async(req,res)=>{try{const r=await query('SELECT name,logo FROM crm_public_branding WHERE id=1');res.set('Cache-Control','no-store');res.json(sanitize(r.rows[0]));}catch(e){if(e.code==='42P01')return res.json(defaults);throw e;}});
 app.get('/api/branding',auth,owner,async(req,res)=>{const r=await query('SELECT name,logo FROM crm_public_branding WHERE id=1');res.json(sanitize(r.rows[0]));});
 app.put('/api/branding',auth,owner,async(req,res)=>{const name=typeof req.body?.name==='string'?normalizeName(req.body.name):'';const logo=req.body?.logo;if(name.length<2||name.length>70)return res.status(400).json({error:'Nombre debe tener entre 2 y 70 caracteres'});if(logo!==null&&logo!==undefined&&!(typeof logo==='string'&&logo.length<=420000&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(logo)))return res.status(400).json({error:'Logo inválido. Usá PNG, JPG o WebP de hasta 300 KB'});const r=await query('INSERT INTO crm_public_branding(id,name,logo) VALUES(1,$1,$2) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,logo=EXCLUDED.logo,updated_at=now() RETURNING name,logo',[name,logo||null]);res.json(sanitize(r.rows[0]));});
}
