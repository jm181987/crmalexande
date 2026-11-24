// Isolated, opt-in reader for existing CRM conversations.
// This file is deliberately NOT imported by server/index.js or any webhook.
import {analyzeConversationSnapshot} from './ai-manager-observer.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function observeStoredConversation({companyId,conversationId,read}={}){
 if(!UUID.test(String(companyId||''))||!UUID.test(String(conversationId||'')))throw new TypeError('Valid companyId and conversationId UUIDs are required');
 if(typeof read!=='function')throw new TypeError('A read-only database query function is required');
 // Explicit company scoping is essential: do not infer tenant from a WhatsApp phone number.
 const c=await read("SELECT v.id,v.company_id,v.external_id,c.id AS contact_id,c.name AS contact_name,c.phone AS contact_phone FROM public.conversations v JOIN public.contacts c ON c.id=v.contact_id AND c.company_id=v.company_id WHERE v.id=$1 AND v.company_id=$2 AND v.channel='whatsapp' LIMIT 1",[conversationId,companyId]);
 if(!c.rows?.length)return null;
 const m=await read("SELECT m.direction,m.body AS text,m.created_at AS at FROM public.messages m JOIN public.conversations v ON v.id=m.conversation_id WHERE v.id=$1 AND v.company_id=$2 AND m.direction IN ('inbound','outbound') ORDER BY m.created_at DESC,m.id DESC LIMIT 100",[conversationId,companyId]);
 const messages=(m.rows||[]).reverse().map(row=>({...row,at:row.at instanceof Date?row.at.toISOString():row.at}));
 const result=analyzeConversationSnapshot({companyId,conversationId,messages});
 return {contact:{id:c.rows[0].contact_id,name:c.rows[0].contact_name,phone:c.rows[0].contact_phone},conversationExternalId:c.rows[0].external_id,analysis:result};
}
