import pg from 'pg';
import 'dotenv/config';
export const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==='true'?{rejectUnauthorized:process.env.DATABASE_SSL_REJECT_UNAUTHORIZED!=='false'}:false,connectionTimeoutMillis:5000,max:10});
export const query=(sql,args=[])=>pool.query(sql,args);
