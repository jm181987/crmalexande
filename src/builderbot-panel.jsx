import React,{useEffect,useState} from 'react';
const labels={
 es:{title:'Recepcionista IA · Integración segura',intro:'Configura la referencia a tu bot sin cambiar la conexión QR actual.',workspace:'ID del workspace (opcional)',bot:'ID del bot (opcional)',save:'Guardar configuración',saving:'Guardando…',status:'Estado',inactive:'Preparada, sin conectar',warning:'El QR actual ya está vinculado al CRM. No escanees el mismo número en otra plataforma hasta confirmar con el proveedor un método compatible de sesión compartida o integración por webhook/API. Guardar estos datos no activa mensajes automáticos.',ok:'Configuración guardada. QR y mensajes actuales sin cambios.'},
 pt:{title:'Recepcionista IA · Integração segura',intro:'Configure a referência do bot sem alterar a conexão QR atual.',workspace:'ID do workspace (opcional)',bot:'ID do bot (opcional)',save:'Salvar configuração',saving:'Salvando…',status:'Status',inactive:'Preparada, não conectada',warning:'O QR atual já está vinculado ao CRM. Não vincule o mesmo número em outra plataforma antes de confirmar um método compatível de compartilhamento de sessão ou integração por webhook/API. Salvar não ativa respostas automáticas.',ok:'Configuração salva. QR e mensagens atuais preservados.'},
 en:{title:'AI Receptionist · Secure integration',intro:'Configure your bot reference without changing the existing CRM QR connection.',workspace:'Workspace ID (optional)',bot:'Bot ID (optional)',save:'Save configuration',saving:'Saving…',status:'Status',inactive:'Prepared, not connected',warning:'The current QR is owned by the existing connection. Do not pair the same number with another platform until session-sharing or API/webhook compatibility is confirmed. Saving does not activate automatic replies.',ok:'Saved. Existing QR and messages remain unchanged.'}
};
export default function AiReceptionPanel({lang='es',user,error}){
 const t=labels[lang]||labels.es;
 const [config,setConfig]=useState({workspace_id:'',bot_id:''}),[busy,setBusy]=useState(false),[saved,setSaved]=useState(false),[loading,setLoading]=useState(true);
 useEffect(()=>{let alive=true;fetch('/api/ai-provider',{credentials:'include'}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error||'Request failed');if(alive)setConfig({workspace_id:d.workspace_id||'',bot_id:d.bot_id||''})}).catch(e=>error(e.message)).finally(()=>{if(alive)setLoading(false)});return()=>{alive=false}},[]);
 const save=async e=>{e.preventDefault();setBusy(true);setSaved(false);try{const r=await fetch('/api/ai-provider',{method:'PUT',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(config)});const d=await r.json();if(!r.ok)throw Error(d.error||'Request failed');setSaved(true)}catch(e){error(e.message)}finally{setBusy(false)}};
 return <section className="panel" style={{padding:20,marginBottom:18}}>
  <h2>{t.title}</h2><p>{t.intro}</p>
  <p><strong>{t.status}:</strong> {t.inactive}</p>
  <p role="note" style={{padding:12,border:'1px solid #e8c77e',borderRadius:10,background:'#fff9eb',color:'#755319'}}>{t.warning}</p>
  <form onSubmit={save} style={{display:'grid',gap:12,maxWidth:540}}>
   <label style={{display:'grid',gap:5}}>{t.workspace}<input value={config.workspace_id} maxLength={120} pattern="[-_a-zA-Z0-9]*" disabled={loading||busy||user.role==='agent'} onChange={e=>setConfig({...config,workspace_id:e.target.value})}/></label>
   <label style={{display:'grid',gap:5}}>{t.bot}<input value={config.bot_id} maxLength={120} pattern="[-_a-zA-Z0-9]*" disabled={loading||busy||user.role==='agent'} onChange={e=>setConfig({...config,bot_id:e.target.value})}/></label>
   {user.role!=='agent'&&<button className="primary" type="submit" disabled={loading||busy}>{busy?t.saving:t.save}</button>}
  </form>{saved&&<p role="status">{t.ok}</p>}
 </section>;
}
