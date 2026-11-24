import test from 'node:test';
import assert from 'node:assert/strict';
import {observeStoredConversation} from './ai-manager-readonly.js';
const companyId='123e4567-e89b-42d3-a456-426614174000';
const conversationId='123e4567-e89b-42d3-a456-426614174001';
test('reads only tenant-scoped conversations and returns recommendations, never mutations',async()=>{
 const sql=[];
 const read=async(q,args)=>{sql.push({q,args});return sql.length===1?{rows:[{contact_id:'contact',contact_name:'Ana',contact_phone:'123',external_id:'main:123'}]}:{rows:[{direction:'outbound',text:'¿Quieres comprar?'},{direction:'inbound',text:'Hola, quiero contratar'}]};};
 const result=await observeStoredConversation({companyId,conversationId,read});
 assert.equal(result.contact.name,'Ana');
 assert.deepEqual(result.analysis.suggestedActions,['review_opportunity']);
 assert.equal(sql.length,2);
 for(const {q,args} of sql){assert.match(q,/^SELECT /);assert.match(q,/company_id=\$2/);assert.deepEqual(args,[conversationId,companyId]);}
});
test('unknown conversation is ignored without querying messages',async()=>{
 let calls=0;const result=await observeStoredConversation({companyId,conversationId,read:async()=>{calls++;return {rows:[]}}});
 assert.equal(result,null);assert.equal(calls,1);
});
test('invalid tenant is rejected before querying',async()=>{
 await assert.rejects(observeStoredConversation({companyId:'',conversationId,read:async()=>{throw Error('must not run')}}),TypeError);
});
