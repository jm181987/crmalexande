import React,{useState} from 'react';

const words={
 es:{title:'Entrenamiento y base de conocimiento',name:'Título',url:'URL HTTPS (opcional)',content:'Información que utilizará la IA',file:'Importar archivo TXT o Markdown',faq:'Pregunta frecuente',answer:'Respuesta',save:'Guardar conocimiento',update:'Actualizar',cancel:'Cancelar',edit:'Editar',remove:'Eliminar',empty:'Todavía no hay documentos',confirm:'¿Eliminar este documento de la base de conocimiento?',notice:'Las URLs se guardan como referencia; el sistema no descarga su contenido automáticamente. Para entrenar la IA, pegá el contenido o importá un archivo de texto.',limit:'Máximo 50.000 caracteres por documento. No se envían respuestas automáticas.'},
 pt:{title:'Treinamento e base de conhecimento',name:'Título',url:'URL HTTPS (opcional)',content:'Informações utilizadas pela IA',file:'Importar arquivo TXT ou Markdown',faq:'Pergunta frequente',answer:'Resposta',save:'Salvar conhecimento',update:'Atualizar',cancel:'Cancelar',edit:'Editar',remove:'Excluir',empty:'Ainda não há documentos',confirm:'Excluir este documento da base de conhecimento?',notice:'URLs são salvas como referência; o sistema não baixa seu conteúdo automaticamente. Cole o conteúdo ou importe um arquivo de texto.',limit:'Máximo de 50.000 caracteres por documento. Nenhuma resposta automática é enviada.'},
 en:{title:'Training and knowledge base',name:'Title',url:'HTTPS URL (optional)',content:'Information used by AI',file:'Import TXT or Markdown file',faq:'Frequently asked question',answer:'Answer',save:'Save knowledge',update:'Update',cancel:'Cancel',edit:'Edit',remove:'Delete',empty:'No documents yet',confirm:'Delete this knowledge entry?',notice:'URLs are saved as references only; their content is not fetched automatically. Paste content or import a text file.',limit:'Maximum 50,000 characters per document. No automatic replies are sent.'}
};
const empty={title:'',url:'',content:''};
const api=async(path,method='GET',body)=>{const r=await fetch('/api'+path,{method,credentials:'include',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Request failed');return d};
export default function KnowledgeManager({lang='es',user,entries=[],refresh,error}){
 const t=words[lang]||words.es,editable=user.role==='owner'||user.role==='manager';
 const [form,setForm]=useState(empty),[id,setId]=useState(null),[busy,setBusy]=useState(false),[question,setQuestion]=useState(''),[answer,setAnswer]=useState('');
 const start=x=>{setId(x.id);setForm({title:x.title||'',url:x.url||'',content:x.content||''});setQuestion('');setAnswer('')};
 const cancel=()=>{setId(null);setForm(empty);setQuestion('');setAnswer('')};
 const save=async e=>{e.preventDefault();if(!editable||busy)return;setBusy(true);try{const content=[form.content.trim(),question.trim()&&answer.trim()?'Pregunta: '+question.trim()+'\nRespuesta: '+answer.trim():''].filter(Boolean).join('\n\n');if(!content||content.length>50000)throw Error(t.limit);await api(id?'/knowledge/'+id:'/knowledge',id?'PUT':'POST',{title:form.title.trim(),url:form.url.trim()||null,content});cancel();refresh()}catch(e){error(e.message)}finally{setBusy(false)}};
 const loadFile=async file=>{if(!file)return;try{if(!/\.(txt|md)$/i.test(file.name)||file.size>100000)throw Error('TXT/MD · 100 KB max');const value=await file.text();if(value.length>50000)throw Error(t.limit);setForm(v=>({...v,title:v.title||file.name.replace(/\.(txt|md)$/i,''),content:value}))}catch(e){error(e.message)}};
 return <section className="panel" style={{padding:20,marginBottom:18}}>
  <h2>{t.title}</h2><p>{t.notice}</p>
  {editable&&<form onSubmit={save} style={{display:'grid',gap:10,marginBottom:20}}>
   <label>{t.name}<input required maxLength={180} value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></label>
   <label>{t.url}<input type="url" placeholder="https://" value={form.url} onChange={e=>setForm({...form,url:e.target.value})}/></label>
   <label>{t.file}<input type="file" accept=".txt,.md,text/plain,text/markdown" onChange={e=>{loadFile(e.target.files?.[0]);e.target.value=''}}/></label>
   <label>{t.content}<textarea rows={5} maxLength={50000} value={form.content} onChange={e=>setForm({...form,content:e.target.value})}/></label>
   <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:10}}>
    <label>{t.faq}<input value={question} onChange={e=>setQuestion(e.target.value)}/></label>
    <label>{t.answer}<input value={answer} onChange={e=>setAnswer(e.target.value)}/></label>
   </div>
   <small>{t.limit}</small><div style={{display:'flex',gap:8}}><button className="primary" disabled={busy||!form.title.trim()||!(form.content.trim()||(question.trim()&&answer.trim()))}>{id?t.update:t.save}</button>{id&&<button type="button" onClick={cancel}>{t.cancel}</button>}</div>
  </form>}
  {!entries.length?<p>{t.empty}</p>:<div style={{display:'grid',gap:10}}>{entries.map(x=><div key={x.id} style={{border:'1px solid var(--border,#dce3ed)',padding:12,borderRadius:10}}><strong>{x.title}</strong>{x.url&&<div><a href={x.url} target="_blank" rel="noopener noreferrer">{x.url}</a></div>}<p style={{whiteSpace:'pre-wrap',maxHeight:95,overflow:'auto'}}>{x.content}</p>{editable&&<div style={{display:'flex',gap:8}}><button type="button" onClick={()=>start(x)}>{t.edit}</button><button type="button" disabled={busy} onClick={async()=>{if(!window.confirm(t.confirm))return;setBusy(true);try{await api('/knowledge/'+x.id,'DELETE');if(id===x.id)cancel();refresh()}catch(e){error(e.message)}finally{setBusy(false)}}}>{t.remove}</button></div>}</div>)}</div>}
 </section>;
}
