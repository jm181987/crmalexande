import {createHmac,timingSafeEqual} from 'node:crypto';

const strict=()=>process.env.CRM_MEDIA_REQUIRE_SIGNATURE==='true';
const secret=()=>process.env.CRM_MEDIA_SIGNING_SECRET||'';
const validId=id=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const mac=(kind,id,expiry)=>createHmac('sha256',secret()).update([kind,id,expiry].join(':')).digest('hex');
export function signedMediaPath(kind,id,ttlSeconds=86400){
 if(!['chat','inventory'].includes(kind)||!validId(id))throw Error('Invalid media reference');
 const base='/api/public/'+(kind==='chat'?'chat-media':'inventory-image')+'/'+id;
 if(!strict())return base;
 if(secret().length<32)throw Error('CRM_MEDIA_SIGNING_SECRET must be at least 32 characters');
 const exp=String(Math.floor(Date.now()/1000)+ttlSeconds);
 return base+'?exp='+exp+'&sig='+mac(kind,id,exp);
}
export function mediaAuthorized(req,kind){
 if(!strict())return true; // compatibility mode: never describe this as protected
 if(secret().length<32)return false;
 const exp=req.query?.exp,sig=req.query?.sig;
 if(typeof exp!=='string'||!/^\d{10,12}$/.test(exp)||Number(exp)<Math.floor(Date.now()/1000)||Number(exp)>Math.floor(Date.now()/1000)+7*86400||typeof sig!=='string'||!/^[a-f0-9]{64}$/.test(sig))return false;
 const expected=Buffer.from(mac(kind,req.params.id,exp),'hex'),actual=Buffer.from(sig,'hex');
 return timingSafeEqual(expected,actual);
}
