import test from 'node:test';
import assert from 'node:assert/strict';
import {signedMediaPath,mediaAuthorized} from '../server/media-access.js';
const id='123e4567-e89b-12d3-a456-426614174000';
test('legacy compatibility is explicit',()=>{
 const old=process.env.CRM_MEDIA_REQUIRE_SIGNATURE;
 process.env.CRM_MEDIA_REQUIRE_SIGNATURE='false';
 assert.equal(signedMediaPath('chat',id),'/api/public/chat-media/'+id);
 assert.equal(mediaAuthorized({params:{id},query:{}},'chat'),true);
 process.env.CRM_MEDIA_REQUIRE_SIGNATURE=old;
});
test('signed links require valid HMAC, type, ID and expiry',()=>{
 const oldFlag=process.env.CRM_MEDIA_REQUIRE_SIGNATURE,oldSecret=process.env.CRM_MEDIA_SIGNING_SECRET;
 process.env.CRM_MEDIA_REQUIRE_SIGNATURE='true';process.env.CRM_MEDIA_SIGNING_SECRET='a'.repeat(64);
 try{
  const path=signedMediaPath('inventory',id,300);
  const u=new URL(path,'https://example.test');
  const query=Object.fromEntries(u.searchParams);
  assert.equal(mediaAuthorized({params:{id},query},'inventory'),true);
  assert.equal(mediaAuthorized({params:{id},query},'chat'),false);
  assert.equal(mediaAuthorized({params:{id:'123e4567-e89b-12d3-a456-426614174001'},query},'inventory'),false);
  assert.equal(mediaAuthorized({params:{id},query:{...query,sig:'0'.repeat(64)}},'inventory'),false);
  assert.equal(mediaAuthorized({params:{id},query:{...query,exp:'1000000000'}},'inventory'),false);
  assert.equal(mediaAuthorized({params:{id},query:{}},'inventory'),false);
 }finally{
  if(oldFlag===undefined)delete process.env.CRM_MEDIA_REQUIRE_SIGNATURE;else process.env.CRM_MEDIA_REQUIRE_SIGNATURE=oldFlag;
  if(oldSecret===undefined)delete process.env.CRM_MEDIA_SIGNING_SECRET;else process.env.CRM_MEDIA_SIGNING_SECRET=oldSecret;
 }
});
