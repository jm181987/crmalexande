import 'dotenv/config';
import fs from 'node:fs/promises';
import bcrypt from 'bcryptjs';
import {pool} from '../server/db.js';
async function migrate(){
 const db=await pool.connect();
 try{
  await db.query(await fs.readFile(new URL('./schema.sql',import.meta.url),'utf8'));
  const r=await db.query('SELECT count(*)::int AS total FROM users');
  if(r.rows[0].total){console.log('Schema ready, existing users preserved');return;}
  const email=process.env.ADMIN_EMAIL?.trim().toLowerCase(),password=process.env.ADMIN_PASSWORD;
  if(!email||!password||password.length<12){console.log('Set ADMIN_EMAIL and ADMIN_PASSWORD (at least 12 characters), then rerun migration to create owner');return;}
  await db.query('BEGIN');
  try{
   const co=await db.query('INSERT INTO companies(name) VALUES($1) RETURNING id',['Alexandre']);
   const id=co.rows[0].id;
   await db.query('INSERT INTO users(company_id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5)',[id,process.env.ADMIN_NAME||'Administrator',email,await bcrypt.hash(password,12),'owner']);
   const pipe=await db.query('INSERT INTO pipelines(company_id,name) VALUES($1,$2) RETURNING id',[id,'Vendas / Ventas / Sales']);
   for(const [i,name] of ['Novo Lead','Em Qualificação','Visita Agendada','Proposta','Vendido','Perdido'].entries())
    await db.query('INSERT INTO stages(pipeline_id,name,position,status) VALUES($1,$2,$3,$4)',[pipe.rows[0].id,name,i,i===4?'won':i===5?'lost':'open']);
   await db.query('COMMIT');console.log('Owner created. Remove ADMIN_PASSWORD from server secrets');
  }catch(e){await db.query('ROLLBACK');throw e;}
 }finally{db.release();await pool.end();}
}
migrate().catch(e=>{console.error('Migration failed:',e.message);process.exit(1)});
