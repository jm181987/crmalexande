import {query} from './db.js';
const safe=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const sanitize=s=>String(s??'').replace(/[\r\n\t]+/g,' ').replace(/[^\x20-\x7e\u00a0-\u00ff]/g,'?').trim();
const esc=s=>sanitize(s).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
function pdf(lines){
 const pages=[];for(let i=0;i<lines.length;i+=52)pages.push(lines.slice(i,i+52));
 const objs=[null],add=x=>(objs.push(x),objs.length-1);
 const root=add(''),pagesId=add(''),font=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),pageIds=[];
 for(const rows of pages){const cmds=['BT','/F1 10 Tf'];rows.forEach((line,i)=>{cmds.push('1 0 0 1 40 '+(805-i*15)+' Tm ('+esc(line)+') Tj')});cmds.push('ET');
 const stream=cmds.join('\n'),contents=add('<< /Length '+Buffer.byteLength(stream,'latin1')+' >>\nstream\n'+stream+'\nendstream');
 pageIds.push(add('<< /Type /Page /Parent '+pagesId+' 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 '+font+' 0 R >> >> /Contents '+contents+' 0 R >>'));}
 objs[root]='<< /Type /Catalog /Pages '+pagesId+' 0 R >>';objs[pagesId]='<< /Type /Pages /Kids ['+pageIds.map(x=>x+' 0 R').join(' ')+'] /Count '+pageIds.length+' >>';
 let output='%PDF-1.4\n',offsets=[0];for(let i=1;i<objs.length;i++){offsets.push(Buffer.byteLength(output,'latin1'));output+=i+' 0 obj\n'+objs[i]+'\nendobj\n'}
 const xref=Buffer.byteLength(output,'latin1');output+='xref\n0 '+objs.length+'\n0000000000 65535 f \n';for(let i=1;i<objs.length;i++)output+=String(offsets[i]).padStart(10,'0')+' 00000 n \n';
 output+='trailer\n<< /Size '+objs.length+' /Root '+root+' 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';return Buffer.from(output,'latin1');
}
export function registerDashboardPdf(app,auth){
 app.get('/api/dashboard/export.pdf',auth,safe(async(req,res)=>{
  const {from,to}=req.query;
  if(typeof from!=='string'||typeof to!=='string'||!/^20\d\d-\d\d-\d\d$/.test(from)||!/^20\d\d-\d\d-\d\d$/.test(to))return res.status(400).json({error:'Invalid dates'});
  const start=new Date(from+'T00:00:00Z'),end=new Date(to+'T00:00:00Z');
  if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||start.toISOString().slice(0,10)!==from||end.toISOString().slice(0,10)!==to||end<start||end-start>366*86400000)return res.status(400).json({error:'Date range must be 1 to 367 calendar days'});
  const args=[req.user.company_id,from,to,req.user.role==='agent'?req.user.id:null];
  const [contacts,conversations,opportunities,tasks,messages,campaigns,topics,team,deliveries,analytics,leadSources,dealDetails,contactDetails,taskDetails,messageDays,followups,attribution,repeatBuyers,appointments,conversationDetails]=await Promise.all([
   query("SELECT count(*)::int n FROM contacts WHERE company_id=$1 AND created_at >= $2::date AND created_at < $3::date+interval '1 day' AND ($4::uuid IS NULL OR owner_id=$4)",args),
   query("SELECT count(*)::int n FROM conversations WHERE company_id=$1 AND created_at >= $2::date AND created_at < $3::date+interval '1 day' AND ($4::uuid IS NULL OR assignee_id=$4)",args),
   query("SELECT status,count(*)::int n,coalesce(sum(value),0)::float amount FROM opportunities WHERE company_id=$1 AND deleted_at IS NULL AND created_at >= $2::date AND created_at < $3::date+interval '1 day' AND ($4::uuid IS NULL OR owner_id=$4) GROUP BY status ORDER BY status",args),
   query("SELECT completed,count(*)::int n FROM tasks WHERE company_id=$1 AND created_at >= $2::date AND created_at < $3::date+interval '1 day' AND ($4::uuid IS NULL OR owner_id=$4) GROUP BY completed",args),
   query("SELECT m.direction,count(*)::int n FROM messages m JOIN conversations v ON v.id=m.conversation_id WHERE v.company_id=$1 AND v.channel='whatsapp' AND m.created_at >= $2::date AND m.created_at < $3::date+interval '1 day' AND ($4::uuid IS NULL OR v.assignee_id=$4) GROUP BY m.direction",args),
   query("SELECT c.name,c.channel,c.status FROM crm_campaigns c WHERE c.company_id=$1 AND c.created_at >= $2::date AND c.created_at < $3::date+interval '1 day' AND ($4::uuid IS NULL OR EXISTS(SELECT 1 FROM crm_campaign_deliveries d JOIN contacts ct ON ct.id=d.contact_id AND ct.company_id=d.company_id WHERE d.campaign_id=c.id AND d.company_id=c.company_id AND ct.owner_id=$4)) ORDER BY c.created_at DESC LIMIT 100",args),
   query("SELECT title,count(*)::int n FROM opportunities WHERE company_id=$1 AND deleted_at IS NULL AND created_at >= $2::date AND created_at < $3::date+interval '1 day' AND ($4::uuid IS NULL OR owner_id=$4) GROUP BY title ORDER BY n DESC,title LIMIT 15",args),
   query("SELECT u.name,count(o.id)::int n FROM users u LEFT JOIN opportunities o ON o.owner_id=u.id AND o.company_id=$1 AND o.deleted_at IS NULL AND o.created_at >= $2::date AND o.created_at < $3::date+interval '1 day' WHERE u.company_id=$1 AND ($4::uuid IS NULL OR u.id=$4) GROUP BY u.id,u.name ORDER BY n DESC LIMIT 40",args),
   query("SELECT c.name,count(d.id)::int n,count(d.id) FILTER(WHERE d.status='sent')::int sent,count(d.id) FILTER(WHERE d.status='failed')::int failed FROM crm_campaigns c JOIN crm_campaign_deliveries d ON d.campaign_id=c.id AND d.company_id=c.company_id WHERE c.company_id=$1 AND coalesce(d.sent_at,d.due_at) >= $2::date AND coalesce(d.sent_at,d.due_at) < $3::date+interval '1 day' AND ($4::uuid IS NULL OR EXISTS(SELECT 1 FROM contacts ct WHERE ct.id=d.contact_id AND ct.company_id=d.company_id AND ct.owner_id=$4)) GROUP BY c.id,c.name ORDER BY n DESC LIMIT 50",args),
   query("SELECT count(*) FILTER(WHERE status='won')::int wins,count(DISTINCT contact_id) FILTER(WHERE status='won')::int buyers,round(avg(extract(epoch FROM (updated_at-created_at))/86400) FILTER(WHERE status='won' AND updated_at>=created_at)::numeric,1)::float cycle_days FROM opportunities WHERE company_id=$1 AND deleted_at IS NULL AND created_at >= $2::date AND created_at < $3::date+interval '1 day' AND ($4::uuid IS NULL OR owner_id=$4)",args)
  ,
   query("SELECT coalesce(source,'Sin origen') source,count(*)::int n FROM contacts WHERE company_id=$1 AND created_at >= $2::date AND created_at < $3::date+interval '1 day' AND ($4::uuid IS NULL OR owner_id=$4) GROUP BY source ORDER BY n DESC LIMIT 40",args),
   query("SELECT o.title,o.status,o.value,o.created_at,ct.name contact_name,u.name owner_name FROM opportunities o LEFT JOIN contacts ct ON ct.id=o.contact_id AND ct.company_id=o.company_id LEFT JOIN users u ON u.id=o.owner_id AND u.company_id=o.company_id WHERE o.company_id=$1 AND o.deleted_at IS NULL AND o.created_at >= $2::date AND o.created_at < $3::date+interval '1 day' AND ($4::uuid IS NULL OR o.owner_id=$4) ORDER BY o.created_at DESC LIMIT 300",args),
   query("SELECT name,source,created_at FROM contacts WHERE company_id=$1 AND created_at >= $2::date AND created_at < $3::date+interval '1 day' AND ($4::uuid IS NULL OR owner_id=$4) ORDER BY created_at DESC LIMIT 200",args),
   query("SELECT t.title,t.completed,t.created_at,c.name contact_name FROM tasks t LEFT JOIN contacts c ON c.id=t.contact_id AND c.company_id=t.company_id WHERE t.company_id=$1 AND t.created_at >= $2::date AND t.created_at < $3::date+interval '1 day' AND ($4::uuid IS NULL OR t.owner_id=$4) ORDER BY t.created_at DESC LIMIT 200",args),
   query("SELECT m.created_at::date day,m.direction,count(*)::int n FROM messages m JOIN conversations v ON v.id=m.conversation_id WHERE v.company_id=$1 AND v.channel='whatsapp' AND m.created_at >= $2::date AND m.created_at < $3::date+interval '1 day' AND ($4::uuid IS NULL OR v.assignee_id=$4) GROUP BY m.created_at::date,m.direction ORDER BY day DESC LIMIT 400",args),
   query("SELECT d.status,count(*)::int n FROM crm_campaign_deliveries d JOIN crm_campaigns c ON c.id=d.campaign_id AND c.company_id=d.company_id WHERE d.company_id=$1 AND c.filters->>'type'='quote_followup' AND coalesce(d.sent_at,d.due_at) >= $2::date AND coalesce(d.sent_at,d.due_at) < $3::date+interval '1 day' AND ($4::uuid IS NULL OR EXISTS(SELECT 1 FROM contacts ct WHERE ct.id=d.contact_id AND ct.company_id=d.company_id AND ct.owner_id=$4)) GROUP BY d.status",args),
   query("WITH attributed AS (SELECT DISTINCT ON(o.id) o.id,o.value,d.campaign_id FROM opportunities o JOIN crm_campaign_deliveries d ON d.company_id=o.company_id AND d.contact_id=o.contact_id AND d.status='sent' AND d.sent_at IS NOT NULL JOIN crm_campaigns c ON c.id=d.campaign_id AND c.company_id=d.company_id WHERE o.company_id=$1 AND o.deleted_at IS NULL AND o.status='won' AND o.created_at >= $2::date AND o.created_at < $3::date+interval '1 day' AND ($4::uuid IS NULL OR o.owner_id=$4) AND d.sent_at<=o.updated_at AND d.sent_at>=o.updated_at-interval '30 days' ORDER BY o.id,d.sent_at DESC,d.id DESC) SELECT c.name,count(a.id)::int wins,coalesce(sum(a.value),0)::float attributed_value FROM attributed a JOIN crm_campaigns c ON c.id=a.campaign_id GROUP BY c.id,c.name ORDER BY attributed_value DESC LIMIT 60",args),
   query("SELECT count(*)::int buyers,count(*) FILTER(WHERE wins>=2)::int repeat_buyers FROM (SELECT contact_id,count(*) wins FROM opportunities WHERE company_id=$1 AND deleted_at IS NULL AND status='won' AND created_at >= $2::date AND created_at < $3::date+interval '1 day' AND ($4::uuid IS NULL OR owner_id=$4) GROUP BY contact_id) x",args),
   query("SELECT title,start_at,end_at,status FROM appointments WHERE company_id=$1 AND start_at >= $2::date AND start_at < $3::date+interval '1 day' AND ($4::uuid IS NULL OR owner_id=$4) ORDER BY start_at LIMIT 200",args),
   query("SELECT v.created_at,c.name contact_name,v.channel FROM conversations v LEFT JOIN contacts c ON c.id=v.contact_id AND c.company_id=v.company_id WHERE v.company_id=$1 AND v.created_at >= $2::date AND v.created_at < $3::date+interval '1 day' AND ($4::uuid IS NULL OR v.assignee_id=$4) ORDER BY v.created_at DESC LIMIT 200",args)
  ]);
  const lines=['ZARKO CRM - REPORTE COMPLETO DEL DASHBOARD','Periodo: '+from+' a '+to,'Empresa: '+req.user.company_id,'Usuario: '+sanitize(req.user.name)+' ('+req.user.role+')','Generado: '+new Date().toISOString(),''];
  const section=s=>lines.push('',s.toUpperCase());
  const push=(s)=>{let v=sanitize(s);while(v.length>95){let i=v.lastIndexOf(' ',95);if(i<30)i=95;lines.push(v.slice(0,i));v=v.slice(i).trim()}lines.push(v)};
  section('Resumen comercial');push('Contactos nuevos: '+contacts.rows[0].n);push('Conversaciones nuevas: '+conversations.rows[0].n);
  let total=0,wins=0;for(const row of opportunities.rows){total+=row.n;if(row.status==='won')wins=row.n;push('Oportunidades '+row.status+': '+row.n+' | Valor: '+Number(row.amount).toFixed(2))}
  push('Conversion de oportunidades creadas, segun estado actual: '+(total?(wins*100/total).toFixed(1)+'%':'Sin datos'));
  push('Clientes compradores (oportunidades ganadas creadas en periodo): '+analytics.rows[0].buyers);push('Tiempo medio hasta actualizacion de venta ganada, dias: '+(analytics.rows[0].cycle_days??'Sin datos'));
  section('Tareas');tasks.rows.forEach(x=>push((x.completed?'Completadas':'Pendientes')+': '+x.n));if(!tasks.rows.length)push('Sin tareas');
  section('Mensajes de WhatsApp');messages.rows.forEach(x=>push(x.direction+': '+x.n));if(!messages.rows.length)push('Sin mensajes');
  section('Campanas creadas');campaigns.rows.forEach(x=>push(x.name+' | '+x.channel+' | '+x.status));if(!campaigns.rows.length)push('Sin campanas');
  section('Entregas de campanas');deliveries.rows.forEach(x=>push(x.name+' | Total '+x.n+' | Enviados '+x.sent+' | Fallidos '+x.failed));if(!deliveries.rows.length)push('Sin entregas');
  section('Intereses comerciales');topics.rows.forEach(x=>push(x.title+': '+x.n));if(!topics.rows.length)push('Sin oportunidades');
  section('Actividad del equipo');team.rows.forEach(x=>push(x.name+': '+x.n+' oportunidades'));if(!team.rows.length)push('Sin registros');

  section('Fuentes de nuevos contactos');
  leadSources.rows.forEach(x=>push(x.source+': '+x.n));if(!leadSources.rows.length)push('Sin datos');
  section('Clientes nuevos - detalle (hasta 200)');
  contactDetails.rows.forEach(x=>push(String(x.created_at).slice(0,10)+' | '+x.name+' | Origen: '+(x.source||'No indicado')));
  if(!contactDetails.rows.length)push('Sin contactos');
  section('Conversaciones iniciadas - detalle (hasta 200)');
  conversationDetails.rows.forEach(x=>push(String(x.created_at).slice(0,10)+' | '+(x.contact_name||'Sin contacto')+' | '+x.channel));
  if(!conversationDetails.rows.length)push('Sin conversaciones');
  section('Oportunidades - detalle (hasta 300)');
  dealDetails.rows.forEach(x=>push(String(x.created_at).slice(0,10)+' | '+x.title+' | '+x.status+' | '+Number(x.value||0).toFixed(2)+' | '+(x.contact_name||'Sin contacto')+' | '+(x.owner_name||'Sin responsable')));
  if(!dealDetails.rows.length)push('Sin oportunidades');
  section('Tareas - detalle (hasta 200)');
  taskDetails.rows.forEach(x=>push(String(x.created_at).slice(0,10)+' | '+x.title+' | '+(x.completed?'Completada':'Pendiente')+' | '+(x.contact_name||'Sin contacto')));
  if(!taskDetails.rows.length)push('Sin tareas');
  section('WhatsApp - actividad diaria (hasta 400 combinaciones)');
  messageDays.rows.forEach(x=>push(String(x.day).slice(0,10)+' | '+x.direction+' | '+x.n+' mensajes'));
  if(!messageDays.rows.length)push('Sin actividad');
  section('Recuperacion de presupuestos - entregas');
  followups.rows.forEach(x=>push(x.status+': '+x.n));if(!followups.rows.length)push('Sin entregas de seguimiento');
  section('Ventas asociadas a campanas - atribucion estimada');
  attribution.rows.forEach(x=>push(x.name+' | Oportunidades ganadas: '+x.wins+' | Valor asociado: '+Number(x.attributed_value).toFixed(2)));
  if(!attribution.rows.length)push('Sin ventas asociadas');
  section('Recompra dentro de oportunidades creadas en el periodo');
  push('Clientes con al menos una oportunidad ganada: '+repeatBuyers.rows[0].buyers);
  push('Clientes con dos o mas oportunidades ganadas: '+repeatBuyers.rows[0].repeat_buyers);
  push('Tasa de recompra estimada: '+(repeatBuyers.rows[0].buyers?(100*repeatBuyers.rows[0].repeat_buyers/repeatBuyers.rows[0].buyers).toFixed(1)+'%':'Sin datos'));
  section('Agenda - citas del periodo (hasta 200)');
  appointments.rows.forEach(x=>push(String(x.start_at).slice(0,16)+' | '+x.title+' | '+x.status));
  if(!appointments.rows.length)push('Sin citas');
  section('Metodologia y limitaciones');push('Los filtros aplican a fechas de creacion de contactos, conversaciones, oportunidades, tareas y campanas. Mensajes usan fecha del registro; entregas usan envio efectivo o fecha prevista.');
  push('El estado de las oportunidades es el actual, no necesariamente el que tenian al cierre del periodo. Importes no equivalen a facturacion contable.');
  push('No se incluyen metricas sin base temporal verificable: primera respuesta, ROI financiero e inventario. La recompra cuenta oportunidades ganadas creadas en el periodo, no cobros reales. La atribucion a campanas usa una ventana de 30 dias y es una estimacion, no causalidad.');
  push('Alcance: empresa activa y permisos del usuario. Los listados detallados estan limitados a 200-400 registros por seccion; el resumen agregado no esta truncado.');
  const buffer=pdf(lines);res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition','attachment; filename="zarko-dashboard-'+from+'-'+to+'.pdf"');res.setHeader('Cache-Control','private, no-store');res.send(buffer);
 }));
}