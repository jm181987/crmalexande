import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeConversationSnapshot,normalizeObservedMessage} from './ai-manager-observer.js';
test('separates customer and assistant messages and does not create actions',()=>{
 const result=analyzeConversationSnapshot({companyId:'tenant-a',conversationId:'chat-1',messages:[{direction:'inbound',text:'Hola quiero contratar esta semana'},{direction:'outbound',text:'Claro, ¿cuántos usuarios?'}]});
 assert.equal(result.customerMessages,1);
 assert.equal(result.assistantMessages,1);
 assert.equal(result.mode,'observe_only');
 assert.deepEqual(result.suggestedActions,['review_opportunity']);
 assert.equal(result.language,'es');
});
test('ignores assistant sales text when classifying client',()=>{
 const result=analyzeConversationSnapshot({companyId:'tenant-a',conversationId:'chat-1',messages:[{direction:'inbound',text:'Hola'},{direction:'outbound',text:'¿Quieres comprar?'}]});
 assert.deepEqual(result.signals,[]);
});
test('rejects missing tenant and conversation identifiers',()=>{
 assert.throws(()=>analyzeConversationSnapshot({companyId:'',conversationId:'x',messages:[]}),TypeError);
 assert.throws(()=>analyzeConversationSnapshot({companyId:'a',conversationId:'',messages:[]}),TypeError);
});
test('ignores invalid messages',()=>{
 assert.equal(normalizeObservedMessage({direction:'inbound',text:''}),null);
 assert.equal(normalizeObservedMessage({direction:'unknown',text:'hola'}),null);
});
