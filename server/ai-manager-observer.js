// ZARKO CRM AI manager — phase 1, isolated read-only analysis utilities.
// Not imported by the application or registered on a webhook. No network or DB writes.
const LANGUAGE_HINTS={es:/\b(hola|quiero|precio|comprar|contratar|gracias|necesito)\b/i,pt:/\b(olá|quero|preço|comprar|contratar|obrigad[oa]|preciso)\b/i,en:/\b(hello|want|price|buy|purchase|thanks|need)\b/i};
const SIGNALS=[
 {key:'pricing',pattern:/\b(precio|preço|price|cotizaci[oó]n|orçamento|quote)\b/i},
 {key:'purchase_interest',pattern:/\b(contratar|comprar|buy|purchase|subscribe|assinar)\b/i},
 {key:'urgency',pattern:/\b(hoy|today|hoje|esta semana|this week|essa semana|urgente|urgent)\b/i},
 {key:'human_requested',pattern:/\b(asesor|vendedor|humano|atendente|representative|human agent)\b/i}
];
export function normalizeObservedMessage(message){
 if(!message||typeof message!=='object')return null;
 const direction=message.direction==='outbound'?'outbound':message.direction==='inbound'?'inbound':null;
 const text=typeof message.text==='string'?message.text.trim().slice(0,12000):'';
 if(!direction||!text)return null;
 return {direction,text,at:typeof message.at==='string'?message.at:null};
}
export function analyzeConversationSnapshot({companyId,conversationId,messages}={}){
 if(typeof companyId!=='string'||!companyId.trim()||typeof conversationId!=='string'||!conversationId.trim())throw new TypeError('companyId and conversationId are required');
 if(!Array.isArray(messages))throw new TypeError('messages must be an array');
 const normalized=messages.slice(-100).map(normalizeObservedMessage).filter(Boolean);
 const customer=normalized.filter(m=>m.direction==='inbound');
 const agent=normalized.filter(m=>m.direction==='outbound');
 const text=customer.map(m=>m.text).join('\n');
 const signals=SIGNALS.filter(s=>s.pattern.test(text)).map(s=>s.key);
 const language=Object.entries(LANGUAGE_HINTS).find(([,pattern])=>pattern.test(text))?.[0]||'und';
 return Object.freeze({companyId,conversationId,language,customerMessages:customer.length,assistantMessages:agent.length,signals,needsHumanReview:signals.includes('human_requested'),suggestedActions:signals.includes('purchase_interest')?['review_opportunity']:signals.includes('pricing')?['review_lead']:[] ,mode:'observe_only'});
}
