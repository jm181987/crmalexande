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
  const [contacts,conversations,opportunities,tasks,messages,campaigns,topics,team,deliveries,analytics]=await Promise.all([
   query("SELECT count(*)::int n FROM contacts WHERE company_id=$1 AND created_at >= $2::date AND created_at < $3::date+interval '1 day' AND ($4::uuid IS NULL OR owner_id=$4)",args),
   query("SELECT count(*)::int n FROM conversations WHERE company_id=$1 AND created_at >= $2::date AND created_at < $3::date+interval '1 day' AND ($4::uuid IS NULL OR assignee_id=$4)",args),
   query("SELECT status,count(*)::int n,coalesce(sum(value),0)::float amount FROM opportunities WHERE company_id=$1 AND deleted_at IS NULL AND created_at >= $2::date AND created_at < $3::date+interval '1 day' AND ($4::uuid IS NULL OR owner_id=$4) GROUP BY status ORDER BY status",args),
   query("SELECT completed,count(*)::int n FROM tasks WHERE company_id=$1 AND created_at >= $2::date AND created_at < $3::date+interval '1 day' AND ($4::uuid IS NULL OR owner_id=$4) GROUP BY completed",args),
   query("SELECT m.direction,count(*)::int n FROM messages m JOIN conversations v ON v.id=m.conversation_id WHERE v.company_id=$1 AND v.channel='whatsapp' AND m.created_at >= $2::date AND m.created_at < $3::date+interval '1 day' AND ($4::uuid IS NULL OR v.assignee_id=$4) GROUP BY m.direction",args),
   query("SELECT name,channel,status FROM crm_campaigns WHERE company_id=$1 AND created_at >= $2::date AND created_at < $3::date+interval '1 day' ORDER BY created_at DESC LIMIT 100",args.slice(0,3)),
   query("SELECT title,count(*)::int n FROM opportunities WHERE company_id=$1 AND deleted_at IS NULL AND created_at >= $2::date AND created_at < $3::date+interval '1 day' AND ($4::uuid IS NULL OR owner_id=$4) GROUP BY title ORDER BY n DESC,title LIMIT 15",args),
   query("SELECT u.name,count(o.id)::int n FROM users u LEFT JOIN opportunities o ON o.owner_id=u.id AND o.company_id=$1 AND o.deleted_at IS NULL AND o.created_at >= $2::date AND o.created_at < $3::date+interval '1 day' WHERE u.company_id=$1 AND ($4::uuid IS NULL OR u.id=$4) GROUP BY u.id,u.name ORDER BY n DESC LIMIT 40",args),
   query("SELECT c.name,count(d.id)::int n,count(d.id) FILTER(WHERE d.status='sent')::int sent,count(d.id) FILTER(WHERE d.status='failed')::int failed FROM crm_campaigns c JOIN crm_campaign_deliveries d ON d.campaign_id=c.id AND d.company_id=c.company_id WHERE c.company_id=$1 AND d.created_at >= $2::date AND d.created_at < $3::date+interval '1 day' AND ($4::uuid IS NULL OR EXISTS(SELECT 1 FROM contacts ct WHERE ct.id=d.contact_id AND ct.company_id=d.company_id AND ct.owner_id=$4)) GROUP BY c.id,c.name ORDER BY n DESC LIMIT 50",args),
   query("SELECT count(*) FILTER(WHERE status='won')::int wins,count(DISTINCT contact_id) FILTER(WHERE status='won')::int buyers,round(avg(extract(epoch FROM (updated_at-created_at))/86400) FILTER(WHERE status='won' AND updated_at>=created_at)::numeric,1)::float cycle_days FROM opportunities WHERE company_id=$1 AND deleted_at IS NULL AND created_at >= $2::date AND created_at < $3::date+interval '1 day' AND ($4::uuid IS NULL OR owner_id=$4)",args)
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
  section('Metodologia y limitaciones');push('Los filtros aplican a fechas de creacion de contactos, conversaciones, oportunidades, tareas y campanas. Mensajes y entregas usan la fecha del registro.');
  push('El estado de las oportunidades es el actual, no necesariamente el que tenian al cierre del periodo. Importes no equivalen a facturacion contable.');
  push('No se incluyen metricas sin base temporal verificable: primera respuesta, ROI, recurrencia de compra e inventario.');
  push('Alcance: empresa activa y permisos del usuario. Los listados de campanas, intereses y equipo tienen limites de filas.');
  const buffer=pdf(lines);res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition','attachment; filename="zarko-dashboard-'+from+'-'+to+'.pdf"');res.setHeader('Cache-Control','private, no-store');res.send(buffer);
 }));
}