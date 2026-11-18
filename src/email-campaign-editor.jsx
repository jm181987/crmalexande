import React,{useState} from 'react';

const starter='<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;padding:28px"><h1>Hola, {{nombre}}</h1><p>Tenemos novedades para compartir contigo.</p><p><a href="https://www.grupozarko.com.br" style="background:#175cd3;color:#fff;padding:12px 20px;text-decoration:none;border-radius:6px">Conocer más</a></p></div>';
const cleanPreview=html=>html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,'').replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,'').replace(/javascript\s*:/gi,'');
export default function EmailCampaignEditor({onCreate}){
 const [name,setName]=useState(''),[subject,setSubject]=useState(''),[html,setHtml]=useState(starter),[mode,setMode]=useState('html'),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const preview=mode==='html'?cleanPreview(html):'<div style="font-family:Arial,sans-serif;white-space:pre-wrap;padding:24px">'+html.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</div>';
 return <section style={{display:'grid',gap:14}}>
  <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
   <label style={{flex:'1 1 220px'}}>Nombre de campaña<input required maxLength={150} value={name} onChange={e=>setName(e.target.value)} placeholder="Novedades de noviembre"/></label>
   <label style={{flex:'1 1 220px'}}>Asunto del email<input required maxLength={150} value={subject} onChange={e=>setSubject(e.target.value)} placeholder="Noticias y novedades"/></label>
  </div>
  <div style={{display:'flex',gap:12,alignItems:'center',flexWrap:'wrap'}}>
   <label>Formato <select value={mode} onChange={e=>setMode(e.target.value)}><option value="html">HTML</option><option value="text">Texto plano</option></select></label>
   <span style={{fontSize:13,opacity:.75}}>Vista previa aislada; no se envía ningún correo al guardar.</span>
  </div>
  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,330px),1fr))',gap:16}}>
   <label style={{display:'grid',gap:6}}>Contenido {mode==='html'?'HTML':'texto'}
    <textarea value={html} onChange={e=>setHtml(e.target.value)} rows={18} maxLength={10000} spellCheck={false} style={{fontFamily:'monospace',width:'100%',boxSizing:'border-box'}}/>
   </label>
   <div><strong>Vista previa del email</strong><iframe title="Vista previa segura del correo" sandbox="" referrerPolicy="no-referrer" srcDoc={preview} style={{display:'block',marginTop:8,width:'100%',height:390,border:'1px solid #ccd3dc',borderRadius:8,background:'#fff'}}/></div>
  </div>
  {error&&<p role="alert" style={{color:'#b42318'}}>{error}</p>}
  <button disabled={busy||!name.trim()||!subject.trim()||!html.trim()} onClick={async()=>{setBusy(true);setError('');try{await onCreate({name:name.trim(),channel:'email',template_name:subject.trim(),content:mode==='html'?html:'[text]'+html});setName('');setSubject('')}catch(e){setError(e.message||'No se pudo guardar')}finally{setBusy(false)}}}>{busy?'Guardando…':'Guardar campaña de email como borrador'}</button>
 </section>;
}
