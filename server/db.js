import pg from 'pg';
import 'dotenv/config';
import {AsyncLocalStorage} from 'node:async_hooks';

export const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==='true'?{rejectUnauthorized:process.env.DATABASE_SSL_REJECT_UNAUTHORIZED!=='false'}:false,connectionTimeoutMillis:5000,max:10});
export const tenantContext=new AsyncLocalStorage();

// Scoped queries always use a dedicated transaction and SET LOCAL, preventing
// tenant context from leaking between requests through pooled connections.
// The flag is intentionally opt-in until policies and auth/webhook paths are migrated.
export const query=async(sql,args=[])=>{
 const tenant=tenantContext.getStore()?.companyId;
 if(!tenant||process.env.TENANT_DB_CONTEXT!=='true')return pool.query(sql,args);
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query("SELECT set_config('app.company_id',$1,true)",[tenant]);
  const result=await client.query(sql,args);
  await client.query('COMMIT');
  return result;
 }catch(err){
  try{await client.query('ROLLBACK')}catch{}
  throw err;
 }finally{client.release()}
};
