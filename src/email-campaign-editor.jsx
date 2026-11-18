import React,{useMemo,useState} from 'react';

const templates={
 welcome:{label:'Bienvenida',subject:'¡Bienvenido a ZARCO!',title:'¡Bienvenido, {{nombre}}!',body:'Nos alegra tenerte con nosotros. Conocé nuestras novedades y servicios.',button:'Conocer ZARCO',url:'https://www.grupozarko.com.br',accent:'#175cd3',footer:'Gracias por confiar en nosotros.'},
 news:{label:'Newsletter',subject:'Novedades de ZARCO',title:'Noticias para vos, {{nombre}}',body:'Te compartimos nuestras novedades más recientes y oportunidades.',button:'Ver novedades',url:'https://www.grupozarko.com.br',accent:'#087f8c',footer:'Recibís este mensaje porque aceptaste nuestras comunicaciones.'},
 offer:{label:'Promoción',subject:'Una propuesta especial para vos',title:'Una oportunidad especial',body:'Hola {{nombre}}, preparamos una propuesta que puede interesarte. Descubrí los detalles.',button:'Ver propuesta',url:'https://www.grupozarko.com.br',accent:'#a33c19',footer:'Oferta sujeta a disponibilidad y condiciones.'},
 followup:{label:'Seguimiento',subject:'Seguimos en contacto',title:'Hola, {{nombre}}',body:'Queríamos saber si pudiste revisar nuestra propuesta. Estamos disponibles para ayudarte.',button:'Contactarnos',url:'https://www.grupozarko.com.br',accent:'#374151',footer:'Equipo ZARCO'}
};
const escapeHtml=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const validUrl=s=>{try{const u=new URL(s);return ['https:','http:'].includes(u.protocol)}catch{return false}};
const renderEmail=v=>`<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:32px 12px;background:#f3f5f9;font-family:Arial,Helvetica,sans-serif;color:#202936"><table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;max-width:620px;margin:auto;background:#fff;border-radius:12px"><tr><td style="padding:34px 32px 12px"><p style="font-size:13px;font-weight:bold;color:${escapeHtml(v.accent)};letter-spacing:2px">ZARCO</p><h1 style="font-size:28px;line-height:1.25;margin:20px 0;color:#1c2533">${escapeHtml(v.title)}</h1><p style="font-size:16px;line-height:1.7;white-space:pre-line">${escapeHtml(v.body).replace(/\n/g,'<br>')}</p><p style="margin:30px 0"><a href="${escapeHtml(validUrl(v.url)?v.url:'https://www.grupozarko.com.br')}" style="background:${escapeHtml(v.accent)};padding:14px 22px;border-radius:7px;color:#fff;text-decoration:none;font-weight:bold;display:inline-block">${escapeHtml(v.button)}</a></p></td></tr><tr><td style="padding:20px 32px;background:#f8fafc;color:#667085;font-size:12px;line-height:1.6">${escapeHtml(v.footer)}</td></tr></table></body></html>`;
const cleanPreview=html=>html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,'').replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,'').replace(/javascript\s*:/gi,'');
const defaultTemplate=templates.welcome;
export default function EmailCampaignEditor({onCreate}){
 const [name,setName]=useState(''),[subject,setSubject]=useState(defaultTemplate.subject),[fields,setFields]=useState({...defaultTemplate}),[editor,setEditor]=useState('visual'),[html,setHtml]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[device,setDevice]=useState('desktop');
 const generated=useMemo(()=>renderEmail(fields),[fields]);
 const finalHtml=editor==='html'?html:generated;
 const choose=(key)=>{const t=templates[key];setFields({...t});setSubject(t.subject);setHtml(renderEmail(t));setEditor('visual');setError('')};
 const change=(key,value)=>setFields(f=>({...f,[key]:value}));
 return <section style={{display:'grid',gap:16}}>
  <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
   <label style={{flex:'1 1 210px'}}>Nombre de campaña<input value={name} onChange={e=>setName(e.target.value)} maxLength={150} placeholder="Campaña de noviembre" required/></label>
   <label style={{flex:'1 1 210px'}}>Asunto del correo<input value={subject} onChange={e=>setSubject(e.target.value)} maxLength={150} required/></label>
  </div>
  <div><strong>Plantillas editables</strong><div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:8}}>{Object.entries(templates).map(([key,t])=><button key={key} type="button" onClick={()=>choose(key)}>{t.label}</button>)}</div></div>
  <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
   <button type="button" aria-pressed={editor==='visual'} onClick={()=>{if(editor==='html'){setError('');setEditor('visual')}else setEditor('visual')}}>Editor visual</button>
   <button type="button" aria-pressed={editor==='html'} onClick={()=>{if(editor==='visual')setHtml(generated);setEditor('html')}}>Editar código HTML</button>
   <span style={{fontSize:12,opacity:.75}}>Cambiar de HTML a visual restaura el diseño generado por los campos visuales.</span>
  </div>
  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,340px),1fr))',gap:18}}>
   <div style={{display:'grid',gap:12,alignContent:'start'}}>
    {editor==='visual'?<>
     <label>Título<input value={fields.title} maxLength={180} onChange={e=>change('title',e.target.value)}/></label>
     <label>Mensaje<textarea rows={7} value={fields.body} maxLength={4000} onChange={e=>change('body',e.target.value)}/></label>
     <label>Texto del botón<input value={fields.button} maxLength={80} onChange={e=>change('button',e.target.value)}/></label>
     <label>Enlace del botón<input value={fields.url} onChange={e=>change('url',e.target.value)} type="url"/></label>
     <label>Color principal <input type="color" value={fields.accent} onChange={e=>change('accent',e.target.value)}/></label>
     <label>Pie de página<textarea rows={3} value={fields.footer} maxLength={500} onChange={e=>change('footer',e.target.value)}/></label>
    </>:<label style={{display:'grid',gap:6}}>Código HTML<textarea value={html} onChange={e=>setHtml(e.target.value)} rows={22} maxLength={10000} spellCheck={false} style={{width:'100%',boxSizing:'border-box',fontFamily:'monospace'}}/></label>}
   </div>
   <div style={{minWidth:0}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,marginBottom:8,flexWrap:'wrap'}}><strong>Vista previa</strong><div><button type="button" onClick={()=>setDevice('desktop')} aria-pressed={device==='desktop'}>Escritorio</button> <button type="button" onClick={()=>setDevice('mobile')} aria-pressed={device==='mobile'}>Móvil</button></div></div>
    <iframe title="Vista previa aislada del email" sandbox="" referrerPolicy="no-referrer" srcDoc={cleanPreview(finalHtml)} style={{display:'block',width:device==='mobile'?'min(100%,375px)':'100%',height:520,border:'1px solid #d0d5dd',borderRadius:8,background:'#fff',margin:'auto',boxSizing:'border-box'}}/>
   </div>
  </div>
  <p style={{fontSize:13,opacity:.8}}>Podés usar {{'{{nombre}'}} para personalizar el saludo. Guardar crea un borrador; no envía correos.</p>
  {error&&<p role="alert" style={{color:'#b42318'}}>{error}</p>}
  <button type="button" disabled={busy||!name.trim()||!subject.trim()||!finalHtml.trim()||finalHtml.length>10000||(editor==='visual'&&!validUrl(fields.url))} onClick={async()=>{setBusy(true);setError('');try{await onCreate({name:name.trim(),channel:'email',template_name:subject.trim(),content:finalHtml});setName('')}catch(e){setError(e.message||'No se pudo guardar')}finally{setBusy(false)}}}>{busy?'Guardando…':'Guardar campaña como borrador'}</button>
 </section>;
}
