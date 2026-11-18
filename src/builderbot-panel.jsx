import React,{useEffect,useState} from 'react';
const api=async(path,method='GET',body)=>{const r=await fetch('/api/builderbot'+path,{method,credentials:'include',headers:{'Content-Type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{})});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Error de BuilderBot');return d};
const field={display:'grid',gap:5,marginBottom:12};
export default function BuilderBotPanel({user,contacts=[]}){
 const owner=user?.role==='owner',operator=owner||user?.role==='manager';
 const [cfg,setCfg]=useState(null),[botId,setBotId]=useState(''),[apiKey,setApiKey]=useState(''),[answerId,setAnswerId]=useState(''),[webhookToken,setWebhookToken]=useState(''),[templates,setTemplates]=useState([]),[events,setEvents]=useState([]),[files,setFiles]=useState([]),[instructions,setInstructions]=useState(''),[selected,setSelected]=useState(''),[content,setContent]=useState(''),[template,setTemplate]=useState(''),[language,setLanguage]=useState('es'),[number,setNumber]=useState(''),[status,setStatus]=useState(''),[busy,setBusy]=useState(false);
 const run=async fn=>{setBusy(true);setStatus('');try{await fn()}catch(e){setStatus('Error: '+e.message)}finally{setBusy(false)}};
 const load=async()=>{if(owner){const x=await api('/settings');setCfg(x);setBotId(x.bot_id||'');setAnswerId(x.assistant_answer_id||'')}};
 useEffect(()=>{if(owner)load().catch(e=>setStatus(e.message))},[owner]);
 if(!operator)return null;
 const save=()=>run(async()=>{const d=await api('/settings','PUT',{bot_id:botId,api_key:apiKey,assistant_answer_id:answerId||null});setWebhookToken(d.webhook_token);setApiKey('');await load();setStatus('Guardado. Copiá ahora el token del webhook; no se mostrará de nuevo.')});
 const readFile=async file=>{if(!file)return;const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file)});await api('/assistant/files','POST',{filename:file.name,mime_type:file.type,base64:data});setStatus('Archivo subido')};
 return <section style={{border:'1px solid #dce5f1',borderRadius:12,padding:18,margin:'16px 0'}}>
 <h2>BuilderBot · WhatsApp y asistente</h2><p>Integración independiente de Evolution API y SendGrid. Los envíos se ejecutan solo al confirmar la acción.</p>
 {owner&&<div style={{border:'1px solid #dce5f1',padding:14,borderRadius:10,marginBottom:16}}>
 <h3>Configuración exclusiva del owner</h3><p>Estado: {cfg?.configured?'Configurado':'Pendiente'} · Cifrado: {cfg?.secret_ready?'Listo':'Falta BUILDERBOT_ENCRYPTION_KEY en Vercel'}</p>
 <label style={field}>ID del bot<input value={botId} onChange={e=>setBotId(e.target.value)} placeholder="UUID del bot"/></label>
 <label style={field}>API Key<input type="password" autoComplete="new-password" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="Clave nueva; no se muestra después"/></label>
 <label style={field}>ID de respuesta del asistente<input value={answerId} onChange={e=>setAnswerId(e.target.value)} placeholder="answerId (UUID)"/></label>
 <button disabled={busy||!apiKey||!botId||!cfg?.secret_ready} onClick={save}>Guardar configuración</button>{' '}
 <button disabled={busy||!cfg?.configured} onClick={()=>run(async()=>{await api('/test','POST');setStatus('Conexión con BuilderBot correcta')})}>Probar conexión</button>
 {webhookToken&&<div><p><strong>Token de webhook (mostrar una sola vez)</strong></p><code style={{overflowWrap:'anywhere'}}>{webhookToken}</code><p>URL: {location.origin}/api/webhooks/builderbot/{botId}</p><p>Header personalizado: X-Zarco-Webhook-Token</p></div>}
 </div>}
 <h3>Enviar a un contacto</h3><label style={field}>Cliente<select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Seleccionar</option>{contacts.filter(c=>c.phone).map(c=><option key={c.id} value={c.id}>{c.name} · {c.phone}</option>)}</select></label>
 <label style={field}>Mensaje<textarea rows={3} value={content} onChange={e=>setContent(e.target.value)}/></label>
 <button disabled={busy||!selected||!content.trim()} onClick={()=>run(async()=>{if(!window.confirm('¿Enviar mensaje por BuilderBot a este contacto?'))return;await api('/messages','POST',{contact_id:selected,content});setStatus('Mensaje enviado a BuilderBot')})}>Enviar mensaje</button>
 <h3>Plantillas oficiales</h3><button disabled={busy} onClick={()=>run(async()=>{const d=await api('/templates');setTemplates(Array.isArray(d)?d:Array.isArray(d.templates)?d.templates:[]);setStatus('Plantillas consultadas')})}>Consultar plantillas</button>
 <label style={field}>Plantilla<select value={template} onChange={e=>setTemplate(e.target.value)}><option value="">Elegir plantilla</option>{templates.map((t,i)=><option key={i} value={t.name||t.templateName}>{t.name||t.templateName}</option>)}</select></label>
 <label style={field}>Idioma<input value={language} onChange={e=>setLanguage(e.target.value)} placeholder="es / pt_BR"/></label>
 <button disabled={busy||!selected||!template} onClick={()=>run(async()=>{if(!window.confirm('¿Enviar plantilla aprobada al contacto?'))return;await api('/templates/send','POST',{contact_id:selected,template_name:template,language_code:language});setStatus('Plantilla enviada a BuilderBot')})}>Enviar plantilla sin variables</button>
 <small>Para plantillas con variables se debe completar el soporte de componentes antes de enviarlas.</small>
 {owner&&<><h3>Asistente y conocimiento</h3>
 <button disabled={busy||!answerId} onClick={()=>run(async()=>{const d=await api('/assistant');setInstructions(d.instructions||d.data?.instructions||'')})}>Cargar instrucciones</button>
 <label style={field}>Prompt del asistente<textarea rows={7} value={instructions} onChange={e=>setInstructions(e.target.value)}/></label>
 <button disabled={busy||!answerId} onClick={()=>run(async()=>{await api('/assistant','POST',{instructions});setStatus('Instrucciones actualizadas')})}>Guardar instrucciones</button>
 <h4>Archivos</h4><input type="file" accept=".pdf,.txt,.md,.docx" disabled={busy||!answerId} onChange={e=>run(async()=>{await readFile(e.target.files?.[0])})}/>
 <button disabled={busy||!answerId} onClick={()=>run(async()=>{const d=await api('/assistant/files');setFiles(Array.isArray(d)?d:Array.isArray(d.files)?d.files:[])})}>Consultar archivos</button>
 <ul>{files.map((f,i)=><li key={i}>{f.name||f.filename||f.id||'Archivo'} <button disabled={busy||!(f.id||f.fileId)} onClick={()=>run(async()=>{if(!window.confirm('¿Eliminar archivo del asistente?'))return;await api('/assistant/files/'+encodeURIComponent(f.id||f.fileId),'DELETE');setFiles(v=>v.filter(x=>x!==f))})}>Eliminar</button></li>)}</ul>
 <h3>Blacklist</h3><label style={field}>Número internacional<input value={number} onChange={e=>setNumber(e.target.value)}/></label>
 <button disabled={busy||!number} onClick={()=>run(async()=>{await api('/blacklist','POST',{number,intent:'add'});setStatus('Número bloqueado')})}>Bloquear</button>{' '}
 <button disabled={busy||!number} onClick={()=>run(async()=>{await api('/blacklist','POST',{number,intent:'remove'});setStatus('Número desbloqueado')})}>Desbloquear</button>
 <h3>Eventos webhook</h3><button disabled={busy} onClick={()=>run(async()=>setEvents(await api('/webhook-events')))}>Ver últimos eventos</button>
 <p>{events.length} eventos cargados</p><div style={{maxHeight:180,overflow:'auto'}}>{events.map(e=><div key={e.id}>{new Date(e.received_at).toLocaleString()} · {e.payload?.event||e.payload?.type||'Evento recibido'}</div>)}</div>
 </>}
 {status&&<p role="status">{status}</p>}
 </section>
}
