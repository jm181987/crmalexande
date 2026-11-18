import React,{useEffect,useState} from 'react';
const api=async(path,method='GET',body)=>{const r=await fetch('/api/builderbot'+path,{method,credentials:'include',headers:{'Content-Type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{})});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Error de Sistema IA 2');return d};
const field={display:'grid',gap:9,marginBottom:18};
export default function BuilderBotPanel({user,contacts=[]}){
 const owner=user?.role==='owner',operator=owner||user?.role==='manager';
 const [activeTab,setActiveTab]=useState('setup'),[cfg,setCfg]=useState(null),[botId,setBotId]=useState(''),[apiKey,setApiKey]=useState(''),[answerId,setAnswerId]=useState(''),[webhookToken,setWebhookToken]=useState(''),[templates,setTemplates]=useState([]),[events,setEvents]=useState([]),[files,setFiles]=useState([]),[instructions,setInstructions]=useState(''),[selected,setSelected]=useState(''),[content,setContent]=useState(''),[template,setTemplate]=useState(''),[language,setLanguage]=useState('es'),[number,setNumber]=useState(''),[status,setStatus]=useState(''),[busy,setBusy]=useState(false);
 const run=async fn=>{setBusy(true);setStatus('');try{await fn()}catch(e){setStatus('Error: '+e.message)}finally{setBusy(false)}};
 const load=async()=>{if(owner){const x=await api('/settings');setCfg(x);setBotId(x.bot_id||'');setAnswerId(x.assistant_answer_id||'')}};
 useEffect(()=>{if(owner)load().catch(e=>setStatus(e.message))},[owner]);
 if(!operator)return null;
 const save=()=>run(async()=>{const d=await api('/settings','PUT',{bot_id:botId,api_key:apiKey,assistant_answer_id:answerId||null});setWebhookToken(d.webhook_token);setApiKey('');await load();setStatus('Guardado. Copiá ahora el token del webhook; no se mostrará de nuevo.')});
 const readFile=async file=>{if(!file)return;const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file)});await api('/assistant/files','POST',{filename:file.name,mime_type:file.type,base64:data});setStatus('Archivo subido')};
 return <section style={{border:'1px solid #dce5f1',borderRadius:16,padding:24,margin:'22px 0',display:'grid',gap:18}}>
 <h2>Sistema IA 2</h2>
 <p>Conectá WhatsApp y administrá el asistente desde un solo lugar. La conexión con Evolution no se modifica.</p>
 <nav aria-label="Secciones de Sistema IA 2" style={{display:'flex',gap:10,flexWrap:'wrap'}}>
 {(owner?[['setup','1. Conexión'],['messages','2. Mensajes y plantillas'],['assistant','3. Asistente'],['advanced','4. Avanzado']]:[['messages','Mensajes y plantillas']]).map(([id,label])=><button key={id} type="button" aria-current={activeTab===id?'page':undefined} onClick={()=>{setActiveTab(id);setStatus('')}} style={{padding:'10px 15px',borderRadius:9,border:activeTab===id?'2px solid #3b82f6':'1px solid #aab5c5',fontWeight:activeTab===id?700:400}}>{label}</button>)}
 </nav>
 {owner&&activeTab==='setup'&&<div style={{border:'1px solid #dce5f1',padding:22,borderRadius:14,display:'grid',gap:14}}>
 <h3>Paso 1 · Preparar conexión</h3>
 <p>Primero configurá la clave de cifrado en Vercel. Luego ingresá el ID del bot y la API Key de tu proveedor. El ID de una URL /project/ puede ser distinto del ID del bot requerido por la API.</p>
 <p><strong>Clave de cifrado:</strong> {cfg?.secret_ready?'Lista':'Pendiente: agregá BUILDERBOT_ENCRYPTION_KEY en Vercel y volvé a desplegar'}.</p>
 <p><strong>Credenciales guardadas:</strong> {cfg?.configured?'Sí':'No'}.</p>
 <h3>Paso 2 · Guardar credenciales</h3>
 <label style={field}>ID del bot (no necesariamente el ID del proyecto)<input value={botId} onChange={e=>setBotId(e.target.value.trim())} placeholder="Identificador UUID de la API"/><small>Buscá el identificador específico del bot en la documentación o panel de API.</small></label>
 <label style={field}>API Key<input type="password" autoComplete="new-password" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder={cfg?.configured?'Ingresá una nueva clave para reemplazarla':'Ingresá la clave privada de API'}/><small>Se guarda cifrada. No se vuelve a mostrar.</small></label>
 <label style={field}>ID de respuesta del asistente (opcional)<input value={answerId} onChange={e=>setAnswerId(e.target.value.trim())} placeholder="UUID de respuesta del asistente"/></label>
 {!cfg?.secret_ready&&<p role="alert">Falta la clave de cifrado en Vercel. No podrás guardar hasta configurarla.</p>}
 {cfg?.secret_ready&&(!botId||!apiKey)&&<p>Para guardar faltan: {[!botId?'ID del bot':null,!apiKey?'API Key':null].filter(Boolean).join(' y ')}.</p>}
 <button disabled={busy||!apiKey||!botId||!cfg?.secret_ready} onClick={save}>{busy?'Procesando…':'Guardar credenciales'}</button>
 <h3>Paso 3 · Verificar conexión</h3>
 <p>Después de guardar, probá la conexión. Se comprobará el acceso real a la API; guardar por sí solo no confirma que los datos sean válidos.</p>
 <button disabled={busy||!cfg?.configured} onClick={()=>run(async()=>{await api('/test','POST');setStatus('Conexión verificada correctamente con la API de Sistema IA 2.')})}>{busy?'Verificando…':'Probar conexión ahora'}</button>
 {!cfg?.configured&&<small>Primero guardá las credenciales para habilitar esta prueba.</small>}
 {webhookToken&&<div><h3>Paso 4 · Webhook (recepción de eventos)</h3><p>Copiá el token ahora; solo se muestra una vez.</p><code style={{overflowWrap:'anywhere'}}>{webhookToken}</code><p>URL: {location.origin}/api/webhooks/builderbot/{botId}</p><p>Encabezado: X-Zarco-Webhook-Token</p><small>El webhook requiere configuración en el proveedor. Guardar credenciales no lo registra automáticamente.</small></div>}
 </div>}
 {activeTab==='messages'&&<> <hr style={{opacity:.18,margin:'12px 0'}}/><h3>Enviar a un contacto</h3><label style={field}>Cliente<select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Seleccionar</option>{(Array.isArray(contacts)?contacts:[]).filter(c=>c.phone).map(c=><option key={c.id} value={c.id}>{c.name} · {c.phone}</option>)}</select></label>
 <label style={field}>Mensaje<textarea rows={3} value={content} onChange={e=>setContent(e.target.value)}/></label>
 <button disabled={busy||!selected||!content.trim()} onClick={()=>run(async()=>{if(!window.confirm('¿Enviar mensaje por Sistema IA 2 a este contacto?'))return;await api('/messages','POST',{contact_id:selected,content});setStatus('Mensaje enviado a Sistema IA 2')})}>Enviar mensaje</button>
 <hr style={{opacity:.18,margin:'12px 0'}}/><h3>Plantillas oficiales</h3><button disabled={busy} onClick={()=>run(async()=>{const d=await api('/templates');setTemplates(Array.isArray(d)?d:Array.isArray(d.templates)?d.templates:[]);setStatus('Plantillas consultadas')})}>Consultar plantillas</button>
 <label style={field}>Plantilla<select value={template} onChange={e=>setTemplate(e.target.value)}><option value="">Elegir plantilla</option>{templates.map((t,i)=><option key={i} value={t.name||t.templateName}>{t.name||t.templateName}</option>)}</select></label>
 <label style={field}>Idioma<input value={language} onChange={e=>setLanguage(e.target.value)} placeholder="es / pt_BR"/></label>
 <button disabled={busy||!selected||!template} onClick={()=>run(async()=>{if(!window.confirm('¿Enviar plantilla aprobada al contacto?'))return;await api('/templates/send','POST',{contact_id:selected,template_name:template,language_code:language});setStatus('Plantilla enviada a Sistema IA 2')})}>Enviar plantilla sin variables</button>
 <small>Para plantillas con variables se debe completar el soporte de componentes antes de enviarlas.</small>
 </>}
 {owner&&activeTab==='assistant'&&<><h3>Asistente y conocimiento</h3>
 <button disabled={busy||!answerId} onClick={()=>run(async()=>{const d=await api('/assistant');setInstructions(d.instructions||d.data?.instructions||'')})}>Cargar instrucciones</button>
 <label style={field}>Prompt del asistente<textarea rows={7} value={instructions} onChange={e=>setInstructions(e.target.value)}/></label>
 <button disabled={busy||!answerId} onClick={()=>run(async()=>{await api('/assistant','POST',{instructions});setStatus('Instrucciones actualizadas')})}>Guardar instrucciones</button>
 <h4>Archivos</h4><input type="file" accept=".pdf,.txt,.md,.docx" disabled={busy||!answerId} onChange={e=>run(async()=>{await readFile(e.target.files?.[0])})}/>
 <button disabled={busy||!answerId} onClick={()=>run(async()=>{const d=await api('/assistant/files');setFiles(Array.isArray(d)?d:Array.isArray(d.files)?d.files:[])})}>Consultar archivos</button>
 <ul>{files.map((f,i)=><li key={i}>{f.name||f.filename||f.id||'Archivo'} <button disabled={busy||!(f.id||f.fileId)} onClick={()=>run(async()=>{if(!window.confirm('¿Eliminar archivo del asistente?'))return;await api('/assistant/files/'+encodeURIComponent(f.id||f.fileId),'DELETE');setFiles(v=>v.filter(x=>x!==f))})}>Eliminar</button></li>)}</ul>
 </>}
 {owner&&activeTab==='advanced'&&<><h3>Lista de números bloqueados</h3><label style={field}>Número internacional<input value={number} onChange={e=>setNumber(e.target.value)}/></label>
 <button disabled={busy||!number} onClick={()=>run(async()=>{await api('/blacklist','POST',{number,intent:'add'});setStatus('Número bloqueado')})}>Bloquear</button>{' '}
 <button disabled={busy||!number} onClick={()=>run(async()=>{await api('/blacklist','POST',{number,intent:'remove'});setStatus('Número desbloqueado')})}>Desbloquear</button>
 <hr style={{opacity:.18,margin:'12px 0'}}/><h3>Eventos webhook</h3><button disabled={busy} onClick={()=>run(async()=>setEvents(await api('/webhook-events')))}>Ver últimos eventos</button>
 <p>{events.length} eventos cargados</p><div style={{maxHeight:180,overflow:'auto'}}>{events.map(e=><div key={e.id}>{new Date(e.received_at).toLocaleString()} · {e.payload?.event||e.payload?.type||'Evento recibido'}</div>)}</div>
 </>}
 {status&&<p role="status" style={{padding:12,borderRadius:8,border:'1px solid #8aa4c8',overflowWrap:'anywhere'}}>{status}</p>}
 </section>
}
