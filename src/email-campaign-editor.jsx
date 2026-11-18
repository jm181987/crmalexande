import './email-campaign-editor.css';
import React,{useMemo,useState} from 'react';

const templates={
 welcome:{label:'Bienvenida',subject:'¡Bienvenido a ZARCO!',title:'¡Bienvenido, {{nombre}}!',body:'Nos alegra tenerte con nosotros. Conocé nuestras novedades y servicios.',button:'Conocer ZARCO',url:'https://www.grupozarko.com.br',accent:'#175cd3',footer:'Gracias por confiar en nosotros.',eyebrow:'BIENVENIDO A NUESTRA COMUNIDAD',subtitle:'Un nuevo comienzo',image:'https://images.unsplash.com/photo-1497366754035-f200968a6e72?w=1200&auto=format&fit=crop&q=80',imageAlt:'Espacio de trabajo moderno'},
 news:{label:'Newsletter',subject:'Novedades de ZARCO',title:'Noticias para vos, {{nombre}}',body:'Te compartimos nuestras novedades más recientes y oportunidades.',button:'Ver novedades',url:'https://www.grupozarko.com.br',accent:'#087f8c',footer:'Recibís este mensaje porque aceptaste nuestras comunicaciones.',eyebrow:'ACTUALIDAD · NOVIEMBRE',subtitle:'Ideas, noticias y oportunidades',image:'https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=1200&auto=format&fit=crop&q=80',imageAlt:'Cuaderno y espacio de trabajo'},
 offer:{label:'Promoción',subject:'Una propuesta especial para vos',title:'Una oportunidad especial',body:'Hola {{nombre}}, preparamos una propuesta que puede interesarte. Descubrí los detalles.',button:'Ver propuesta',url:'https://www.grupozarko.com.br',accent:'#a33c19',footer:'Oferta sujeta a disponibilidad y condiciones.',eyebrow:'EDICIÓN ESPECIAL',subtitle:'Una propuesta pensada para vos',image:'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1200&auto=format&fit=crop&q=80',imageAlt:'Panel de trabajo y análisis'},
 followup:{label:'Seguimiento',subject:'Seguimos en contacto',title:'Hola, {{nombre}}',body:'Queríamos saber si pudiste revisar nuestra propuesta. Estamos disponibles para ayudarte.',button:'Contactarnos',url:'https://www.grupozarko.com.br',accent:'#374151',footer:'Equipo ZARCO',eyebrow:'SEGUIMOS CONECTADOS',subtitle:'Estamos para acompañarte',image:'https://images.unsplash.com/photo-1521737711867-e3b97375f902?w=1200&auto=format&fit=crop&q=80',imageAlt:'Equipo colaborando'}
};
const escapeHtml=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const validUrl=s=>{try{const u=new URL(s);return ['https:','http:'].includes(u.protocol)}catch{return false}};
const safeImageUrl=s=>validUrl(s)&&String(s).length<=2000?String(s):'';
const renderEmail=v=>`<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:32px 12px;background:#f3f5f9;font-family:Arial,Helvetica,sans-serif;color:#202936"><table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;max-width:620px;margin:auto;background:#fff;border-radius:12px"><tr><td style="padding:34px 32px 12px"><p style="font-size:13px;font-weight:bold;color:${escapeHtml(v.accent)};letter-spacing:2px">ZARCO</p><p style="font-size:11px;letter-spacing:2px;font-weight:bold;color:${escapeHtml(v.accent)}">${escapeHtml(v.eyebrow||"")}</p><h1 style="font-size:28px;line-height:1.25;margin:20px 0;color:#1c2533">${escapeHtml(v.title)}</h1><p style="font-size:18px;color:#667085;line-height:1.4;margin:0 0 18px">${escapeHtml(v.subtitle||"")}</p></td></tr>${safeImageUrl(v.image)?`<tr><td><img src="${escapeHtml(v.image)}" alt="${escapeHtml(v.imageAlt||"Imagen de campaña")}" width="620" style="display:block;width:100%;max-width:620px;height:auto;border:0" /></td></tr>`:""}<tr><td style="padding:24px 32px 12px"><p style="font-size:16px;line-height:1.7;white-space:pre-line">${escapeHtml(v.body).replace(/\n/g,'<br>')}</p><p style="margin:30px 0"><a href="${escapeHtml(validUrl(v.url)?v.url:'https://www.grupozarko.com.br')}" style="background:${escapeHtml(v.accent)};padding:14px 22px;border-radius:7px;color:#fff;text-decoration:none;font-weight:bold;display:inline-block">${escapeHtml(v.button)}</a></p></td></tr><tr><td style="padding:20px 32px;background:#f8fafc;color:#667085;font-size:12px;line-height:1.6">${escapeHtml(v.footer)}</td></tr></table></body></html>`;
const cleanPreview=html=>html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,'').replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,'').replace(/javascript\s*:/gi,'');
const defaultTemplate=templates.welcome;
export default function EmailCampaignEditor({onCreate}){
 const [name,setName]=useState(''),[subject,setSubject]=useState(defaultTemplate.subject),[fields,setFields]=useState({...defaultTemplate}),[editor,setEditor]=useState('visual'),[html,setHtml]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[device,setDevice]=useState('desktop');
 const generated=useMemo(()=>renderEmail(fields),[fields]);
 const finalHtml=editor==='html'?html:generated;
 const choose=(key)=>{const t=templates[key];setFields({...t});setSubject(t.subject);setHtml(renderEmail(t));setEditor('visual');setError('')};
 const change=(key,value)=>setFields(f=>({...f,[key]:value}));
 const [imageMessage,setImageMessage]=useState('');
 const onImageFile=e=>{const file=e.target.files?.[0];if(!file)return;setImageMessage('Para enviar imágenes por email necesitás una URL pública HTTPS. Subí la imagen a tu alojamiento de imágenes y pegá su enlace aquí; los archivos locales no se incrustan porque muchos clientes de correo los bloquean.');e.target.value=''};
 return <section className="email-studio">
  <div className="email-studio-intro"><div><span className="email-studio-eyebrow">CAMPAIGN STUDIO</span><h2>Diseñá tu próximo email</h2><p>Elegí una plantilla, personalizá cada detalle y revisá el resultado antes de guardar.</p></div><span className="email-studio-draft">● Borrador seguro</span></div>
  <div className="email-studio-meta">
   <label style={{flex:'1 1 210px'}}>Nombre de campaña<input value={name} onChange={e=>setName(e.target.value)} maxLength={150} placeholder="Campaña de noviembre" required/></label>
   <label style={{flex:'1 1 210px'}}>Asunto del correo<input value={subject} onChange={e=>setSubject(e.target.value)} maxLength={150} required/></label>
  </div>
  <div className="email-studio-templates"><div className="email-studio-section-title"><strong>Elegí un punto de partida</strong><span>4 diseños listos para personalizar</span></div><div className="email-studio-template-list">{Object.entries(templates).map(([key,t])=><button className={'email-studio-template '+(fields.label===t.label?'is-selected':'')} key={key} type="button" onClick={()=>choose(key)}><span className="email-studio-template-art" style={{'--template-accent':t.accent}}><span/><span/><i/></span><strong>{t.label}</strong><small>{key==='welcome'?'Primer contacto':key==='news'?'Novedades':key==='offer'?'Ofertas':'Conversaciones'}</small></button>)}</div></div>
  <div className="email-studio-toolbar"><div className="email-studio-segments">
   <button type="button" aria-pressed={editor==='visual'} onClick={()=>{if(editor==='html'){setError('');setEditor('visual')}else setEditor('visual')}}>Editor visual</button>
   <button type="button" aria-pressed={editor==='html'} onClick={()=>{if(editor==='visual')setHtml(generated);setEditor('html')}}>Editar código HTML</button>
   </div><span className="email-studio-toolbar-hint">Los cambios se reflejan en la vista previa</span></div>
  <div className="email-studio-workspace">
   <div className="email-studio-fields"><div className="email-studio-panel-heading"><strong>{editor==='visual'?'Personalizar contenido':'Código HTML'}</strong><span>{editor==='visual'?'Editá textos, botón y colores':'Modo avanzado'}</span></div>
    {editor==='visual'?<>
     <label>Etiqueta superior<input value={fields.eyebrow||''} maxLength={90} onChange={e=>change('eyebrow',e.target.value)}/></label>
     <label>Título<input value={fields.title} maxLength={180} onChange={e=>change('title',e.target.value)}/></label>
     <label>Subtítulo<input value={fields.subtitle||''} maxLength={160} onChange={e=>change('subtitle',e.target.value)}/></label>
     <div className="email-studio-image-controls"><strong>Imagen principal</strong><label>URL pública de imagen (HTTPS)<input type="url" value={fields.image||''} onChange={e=>{change('image',e.target.value);setImageMessage('')}} placeholder="https://.../imagen.jpg"/></label><label>Descripción accesible<input value={fields.imageAlt||''} maxLength={160} onChange={e=>change('imageAlt',e.target.value)}/></label><label className="email-studio-upload">Elegir imagen desde mi equipo<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={onImageFile}/></label>{imageMessage&&<p className="email-studio-note" role="status">{imageMessage}</p>}<button type="button" onClick={()=>change('image','')}>Quitar imagen</button></div>
     <label>Mensaje<textarea rows={7} value={fields.body} maxLength={4000} onChange={e=>change('body',e.target.value)}/></label>
     <label>Texto del botón<input value={fields.button} maxLength={80} onChange={e=>change('button',e.target.value)}/></label>
     <label>Enlace del botón<input value={fields.url} onChange={e=>change('url',e.target.value)} type="url"/></label>
     <label>Color principal <input type="color" value={fields.accent} onChange={e=>change('accent',e.target.value)}/></label>
     <label>Pie de página<textarea rows={3} value={fields.footer} maxLength={500} onChange={e=>change('footer',e.target.value)}/></label>
    </>:<label style={{display:'grid',gap:6}}>Código HTML<textarea value={html} onChange={e=>setHtml(e.target.value)} rows={22} maxLength={10000} spellCheck={false} style={{width:'100%',boxSizing:'border-box',fontFamily:'monospace'}}/></label>}
   </div>
   <div className="email-studio-preview"><div className="email-studio-preview-head"><div><strong>Vista previa</strong><span>Así lo recibirán tus contactos</span></div><div className="email-studio-device"><button type="button" onClick={()=>setDevice('desktop')} aria-pressed={device==='desktop'}>Escritorio</button> <button type="button" onClick={()=>setDevice('mobile')} aria-pressed={device==='mobile'}>Móvil</button></div></div>
    <div className="email-studio-preview-stage"><iframe title="Vista previa aislada del email" sandbox="" referrerPolicy="no-referrer" srcDoc={cleanPreview(finalHtml)} style={{width:device==='mobile'?'min(100%,375px)':'100%'}}/></div>
   </div>
  </div>
  <p className="email-studio-note">Podés usar {'{{nombre}}'} para personalizar el saludo. Guardar crea un borrador; no envía correos.</p>
  {error&&<p role="alert" style={{color:'#b42318'}}>{error}</p>}
  <div className="email-studio-actions"><span>Sin envíos automáticos. Solo se guardará el borrador.</span><button type="button" disabled={busy||!name.trim()||!subject.trim()||!finalHtml.trim()||finalHtml.length>10000||(editor==='visual'&&(!validUrl(fields.url)||(fields.image&&!safeImageUrl(fields.image))))} onClick={async()=>{setBusy(true);setError('');try{await onCreate({name:name.trim(),channel:'email',template_name:subject.trim(),content:finalHtml});setName('')}catch(e){setError(e.message||'No se pudo guardar')}finally{setBusy(false)}}}>{busy?'Guardando…':'Guardar borrador'}</button></div>
 </section>;
}
