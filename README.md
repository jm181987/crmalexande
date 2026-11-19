# Alexandre CRM — Español / Português / English

Starter CRM web app using React, Express and PostgreSQL.

## Implemented
- Login with bcrypt password hashes and HTTP-only session JWT.
- Company-based access isolation; owner, manager and agent roles.
- Dashboard: leads, open opportunity value, closed revenue, conversations, pending tasks.
- Contacts with search and tags; database has JSON custom fields.
- Visual Kanban pipelines, stage totals, drag & drop; loss reason is required.
- Conversations and private internal notes (**these do not send actual WhatsApp messages**).
- Tasks, calendar appointments with overlap check, and user creation.
- Spanish, Portuguese and English interface with responsive desktop/mobile layout.

## Dependencies & configuration
Node.js >=20 and a reachable PostgreSQL database. **No real passwords should ever be committed.**

Set runtime environment variables (see `.env.example`):
```
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DBNAME
DATABASE_SSL=false
JWT_SECRET=GENERATE_A_LONG_RANDOM_SECRET
COOKIE_SECURE=true
PORT=3001
ADMIN_EMAIL=owner@example.com
ADMIN_PASSWORD=A_STRONG_UNIQUE_12_PLUS_CHARACTER_PASSWORD
```

`DATABASE_URL` must only exist in private deployment secrets, never in client-side variables. Use `DATABASE_SSL=true` when the PostgreSQL host supports TLS, and configure appropriate certificate validation.

## Install / run

```bash
npm install
npm run db:migrate
npm run build
NODE_ENV=production npm start
```

The first migration creates the schema and, if the database has no CRM users, creates the first owner and default pipeline with `ADMIN_EMAIL` / `ADMIN_PASSWORD`. Remove `ADMIN_PASSWORD` after successful bootstrap. The app serves the built frontend via the Express server. Health: `GET /api/health`.

For development, start `npm start` and `npm run dev` in two terminals; Vite proxies `/api` requests to port 3001.

## Planned next modules
**Not yet implemented and not to be confused with working integrations:** WhatsApp Cloud API, Instagram Direct, Messenger, SMS, email, site webchat, AI conversation agent/knowledge ingestion, Meta and Google lead ads, campaign sending, follow-up and SLA workflows, Google/Outlook sync, external review platforms, file attachments, advanced smart lists, and complete reporting.

These need provider API credentials and permissions, verified webhooks, outbound opt-in checks, rate limiting, background job workers, secure file storage, audit controls and operational tests. Respect Meta template approvals and WhatsApp messaging windows; comply with applicable privacy and marketing laws.

## Deployment and security
- PostgreSQL on port 5432 should not be publicly exposed without network restrictions. Prefer private host routing and TLS.
- Rotate the database password if it was included in a chat or deployment log.
- Set `COOKIE_SECURE=true` behind HTTPS and a long random `JWT_SECRET`.
- API scopes agent records by ownership and all records by company, not only frontend UI filters.
- Before handling real customer data, add login rate limiting, backup/restore tests, structured audit logging, production migrations, full input validation, CSRF protection as needed, data retention controls and monitored job queues.

## Phase 2 modules (Vercel-compatible)
- Contact editing and filtering by source and tags.
- Reports for pipeline stages, team, lead sources, won opportunities and tasks.
- Automation rule registry with enable/disable switches. **Rules are not yet executed automatically**; a durable event processor is required.
- Campaign drafts for WhatsApp, email and SMS. **No outbound sending is implemented**.
- AI instructions/modes and knowledge text/HTTPS URL registry. **No model provider or URL ingestion is connected**.
- Review request drafts, and integration status catalog. **No external review requests are sent**.
- Existing opportunities Kanban, internal inbox, calendar and task functionality remains available.

### Mandatory production migration
Run `scripts/modules.sql` once on the existing PostgreSQL database (as a database administrator) before using the new modules, or run `npm run db:migrate` from a secure Node environment with database connectivity. The migration is additive and does not remove existing users or records. On Vercel, redeploy after the migration. New API routes are registered under `/api` and retain company/role scoping.

### Integration prerequisites
Real WhatsApp Cloud API, Instagram/Messenger, SMS, email, Google/Outlook Calendar, Ads, AI model calls and review delivery need provider-specific credentials, verified webhooks, security validation, opt-in/compliance checks, queues and deployment tests. Do not put provider tokens in the integration metadata form or GitHub; store them as Vercel secrets.

## WhatsApp Cloud API (first real channel integration)
Execute `scripts/whatsapp.sql` as the database administrator on the existing CRM database. No existing rows are deleted. Configure the following **server-side** Vercel environment variables, not VITE_* variables and not in GitHub:
- `WHATSAPP_VERIFY_TOKEN`: a long random string you generate and enter in the Meta webhook settings.
- `WHATSAPP_APP_SECRET`: the Meta app secret used to verify X-Hub-Signature-256.
- `WHATSAPP_ACCESS_TOKEN`: a system-user access token with the appropriate WhatsApp permissions.
- `WHATSAPP_PHONE_NUMBER_ID`: the WhatsApp Business phone number ID.
- `WHATSAPP_COMPANY_ID`: the CRM company's UUID. This release supports **one** configured CRM company/phone number per deployment.
- `WHATSAPP_API_VERSION`: optional pinned supported Graph API version (default `v23.0`; update when required by Meta).

Webhook URL: `https://YOUR-PRODUCTION-DOMAIN/api/webhooks/whatsapp`. Subscribe to the WhatsApp Business Account `messages` webhook field and configure Meta app access and phone-number permissions. HTTPS is mandatory. Redeploy after adding environment variables.

Incoming text messages are matched to contacts by WhatsApp sender ID, create conversations, and are saved with message-ID deduplication. Non-text message types are recorded as placeholders, **not** downloaded or parsed. Outbound free-form text is available through the WhatsApp button in the conversations inbox only during the 24-hour customer service window and only to authorized CRM users. Meta's Graph API is called server-side. The API does not support approved templates, attachments, delivery-status processing, per-company credential storage, or retry queues yet. Webhook requests are verified with HMAC SHA-256; failed signatures are rejected. Do not enable external messaging without end-to-end tests on a test number and opt-in/compliance review.

**Operational caveat:** For production-scale webhook reliability, replace synchronous processing with a durable queue and event retries. Inbound message and conversation creation are not currently wrapped in one transaction, so concurrency and transient database failures need further hardening. Meta may retry non-200 webhook deliveries.

## Evolution API multi-instance setup (replaces single-instance adapter)
Run `scripts/evolution_instances.sql` in the existing PostgreSQL database. Keep `scripts/whatsapp.sql` indexes for message idempotency. Configure **server-only** Vercel variables: `EVOLUTION_API_URL` (HTTPS URL), `EVOLUTION_API_KEY` (global API key), and `PUBLIC_APP_URL` (production CRM HTTPS origin). Redeploy.

In **Integrations > WhatsApp · Evolution API**, an owner or manager creates a connection with a globally unique identifier prefixed `crm-`. The backend uses the global API key to create an Evolution v2 Baileys instance, sets a unique secret webhook URL, and provides a QR code and connection-state lookup. Each instance is stored against its CRM company, and incoming messages are scoped to that company. Outbound replies are routed to the matching instance. Do not store the global API key in browser local storage or the CRM integration metadata.

Evolution v2 instance and webhook API shapes vary by release; verify against the installed version before production rollout. Creation is not transactional across Evolution and PostgreSQL: a webhook setup or database failure may leave a remote instance needing manual reconciliation. No deletion/rotation UI, background retries, media ingestion or automated connection recovery is included yet. Webhook URLs contain a random secret and must not be shared; use a protected HTTPS origin and avoid logging full paths. Webhook payloads are not HMAC-signed by Evolution in this adapter; protect the webhook secret and consider an API gateway/IP restrictions for production.


## Campañas comerciales (WhatsApp / SendGrid)

Se agregó una primera interfaz en **Campañas** para crear campañas, registrar consentimiento por canal, segmentar por etiqueta/origen, preparar destinatarios, consultar conteos y pausar campañas. El estado inicial es **borrador**. Ninguna campaña se envía al prepararla.

**Migración obligatoria:** ejecutar `npm run db:migrate` con `DATABASE_URL` apuntando a la base correcta, en un entorno autorizado. El esquema incremental está en `scripts/modules.sql`. Hacer respaldo antes de migrar. No ejecutar migraciones de producción desde una máquina sin acceso controlado.

**SendGrid (variables privadas del servidor):** `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL` (remitente verificado), `SENDGRID_REPLY_TO` (opcional). Nunca incluir la clave en el navegador ni en `crm_integrations.config`.

**Despacho programado:** `CAMPAIGN_WORKER_SECRET` (mínimo 24 caracteres) y `CAMPAIGN_DELIVERY_ENABLED=true` activan el endpoint privado `POST /api/internal/campaign-dispatch` con `Authorization: Bearer <secret>`. Es necesario configurar un cron externo que llame el endpoint a intervalos regulares; sin cron no hay envío automático. Mantener `CAMPAIGN_DELIVERY_ENABLED` desactivado hasta terminar las pruebas con destinatarios internos. Los registros se procesan en lotes de máximo 10 por ejecución y respetan el `due_at` de cada destinatario. Un HTTP 202 de SendGrid significa **aceptado por el proveedor**, no entregado al buzón.

**Limitaciones actuales:** no hay gestión automática de rebotes, supresiones ni webhooks de SendGrid, ni baja mediante enlace, ni automatizaciones por estado/fecha. La aprobación comercial y el registro de consentimiento son responsabilidad del operador. No usar campañas de correo comerciales hasta implementar el mecanismo de baja y supresiones conforme a las reglas aplicables. WhatsApp debe respetar las políticas de mensajería del proveedor; espaciar envíos no garantiza evitar bloqueos. La recepción de mensajes de Evolution todavía requiere validación real.


### Cancelación de suscripción por email

Cada email comercial enviado por el procesador incluye un enlace firmado a `GET /api/campaigns/unsubscribe`. La página solicita confirmación por `POST` para evitar bajas accidentales causadas por escáneres de enlaces. La confirmación desactiva el consentimiento de email y marca los envíos pendientes como omitidos; no afecta el consentimiento de WhatsApp. Requiere `CAMPAIGN_UNSUBSCRIBE_SECRET` (cadena aleatoria privada de al menos 32 caracteres) y `PUBLIC_APP_URL` con HTTPS y dominio público. **No habilitar envíos de email si falta alguna de estas variables.** La clave no debe cambiarse sin planificar la validez de los enlaces anteriores.

La baja funciona sin sesión CRM. No se ha integrado todavía el Event Webhook firmado de SendGrid para procesar rebotes, bloqueos, spam reports y bajas gestionadas por SendGrid. Hasta contar con ese control y pruebas reales, mantener `CAMPAIGN_DELIVERY_ENABLED=false`.


### Automatizaciones y eventos de SendGrid (etapa siguiente)

- `CRM_AUTOMATIONS_ENABLED=true`: permite que el ejecutor interno cree tareas de seguimiento por inactividad. Las reglas nuevas comienzan desactivadas; un owner/manager debe habilitarlas desde Automatizaciones. Solo se generan **tareas internas**, nunca mensajes automáticos al cliente.
- `POST /api/internal/automation-run`: ejecutar mediante scheduler seguro con el mismo bearer `CAMPAIGN_WORKER_SECRET`. La regla `contact_inactive` admite `config.days` (1–365) y `config.tag` opcional. Se usa el historial de mensajes disponible; si la sincronización de Evolution no funciona, la última actividad puede estar incompleta.
- `SENDGRID_EVENT_PUBLIC_KEY`: clave pública de verificación del Event Webhook firmado de SendGrid (base64, punto EC P-256 sin comprimir). Configurar la URL HTTPS `/api/webhooks/sendgrid` en SendGrid y activar *Signed Event Webhook*. Se procesan bounce, dropped, spamreport y unsubscribe cuando incluyen el `campaign_delivery_id` que adjunta el CRM. La supresión por correo impide nuevos envíos.
- `PUBLIC_APP_URL` y `CAMPAIGN_UNSUBSCRIBE_SECRET` siguen siendo obligatorias para email comercial. Usar `SENDGRID_FROM_EMAIL` verificado.

**Cron sugerido:** invocar los endpoints privados de despacho y automatizaciones cada minuto y cada día, respectivamente, desde un programador externo confiable, usando HTTPS y `Authorization: Bearer <CAMPAIGN_WORKER_SECRET>`. La configuración del cron no se crea automáticamente en Vercel.

**Antes de producción:** aplicar migraciones, probar la firma del webhook con un evento real, confirmar que los emails se suprimen, probar baja y doble ejecución del cron, verificar envíos y recepción de WhatsApp, y habilitar gradualmente con contactos internos. Mantener `CAMPAIGN_DELIVERY_ENABLED=false` y `CRM_AUTOMATIONS_ENABLED=false` hasta completar pruebas. El código no demuestra por sí solo un despliegue exitoso.


### Diagnóstico de desconexiones WhatsApp / Evolution

En **Configuración → Integraciones → WhatsApp** se puede consultar estado real, historial de cambios y diagnóstico del webhook. El sondeo de estado es de solo lectura; no se reinicia ni se elimina la instancia. El botón de QR no aparece para sesiones ya conectadas. Para registrar el historial, aplicar la migración de `scripts/modules.sql`.

Si el estado remoto cambia de `open` a `close`/ `connecting`, revisar los logs del contenedor Evolution (motivo de desconexión y reinicios), estabilidad de red, persistencia del volumen de sesiones, disponibilidad de PostgreSQL/Redis si aplica, y el estado de **Dispositivos vinculados** en el teléfono. Una caída de webhook puede impedir recibir mensajes en CRM pero no equivale a una desconexión de WhatsApp. No borrar ni recrear instancias ni rotar sesiones como primer paso. La URL pública `PUBLIC_APP_URL` es obligatoria para crear y reparar webhooks, pero no para consultar estado ni enviar mensajes.

**Limitación:** sin acceso operativo al servidor Evolution y sin logs de desconexión no se puede confirmar la causa ni garantizar que una sesión permanezca conectada. El estado de la API no se puede inferir solo del panel.


## Stock e inventario: múltiples fotografías por artículo

El módulo **Stock e inventario** permite registrar productos, vehículos, inmuebles y servicios con nombre, código SKU, descripción, precio, moneda, cantidad, estado, características y fotografías. La edición corresponde a usuarios con rol **owner** o **manager**; los datos se consultan dentro de la empresa autenticada.

### Galería de fotografías en el editor

1. Abrir **Stock e inventario** y pulsar **Agregar artículo** o **Editar** en un artículo existente.
2. En la sección **Fotos**, seleccionar varias imágenes JPG, PNG o WebP (hasta **12 por artículo** y **2 MB por archivo**).
3. Las imágenes cargadas aparecen como miniaturas; la primera está identificada como **Portada**. Es posible abrir cada imagen en tamaño completo y quitarla de la galería.
4. Pulsar **Guardar** para asociar la galería al artículo. Si se cancela la edición, las fotos subidas pero no asociadas pueden permanecer almacenadas; actualmente no hay limpieza automática de archivos huérfanos.

Los artículos que ya tenían una única foto siguen siendo compatibles: `image_url` conserva la portada. La galería se guarda en `attributes._image_urls`, y la API devuelve `image_urls` como lista. No se requiere una migración SQL adicional **para la galería**, pero la carga de imágenes depende de las tablas y funciones existentes en `scripts/inventory.sql`. En instalaciones antiguas, aplicar primero ese script en la base correcta y revisar permisos y RLS.

### Compartir todas las fotos por WhatsApp

En una conversación WhatsApp vinculada a una instancia de Evolution API, el envío de inventario (`POST /api/conversations/:id/inventory-send`) admite **1 a 8 artículos diferentes** por solicitud. Por cada artículo se envía **una imagen por mensaje**, en el orden de la galería:

- **Primera foto:** incluye en el texto adjunto la ficha del artículo (nombre, precio, disponibilidad, referencia y descripción, cuando existen).
- **Fotos siguientes:** llevan una identificación correlativa (`2/N`, `3/N`, etc.) y el nombre del artículo.
- Cada envío se registra en el historial de mensajes de la conversación. Si una imagen falla, la API informa los envíos ya efectuados y el número de fotos enviadas del artículo parcial; no se debe repetir toda la operación sin revisar ese resultado.

La ruta de envío exige fotos con URL HTTPS válida, comprueba que los archivos internos pertenezcan a la empresa y utiliza la instancia de WhatsApp ya vinculada a la conversación. **No crea una nueva sesión QR ni habilita envíos automáticos de inventario.** La entrega final al dispositivo del cliente depende de Evolution API y WhatsApp: una respuesta correcta de la API no equivale a una confirmación de lectura o recepción.

El botón **Compartir por WhatsApp** del listado abre un enlace `wa.me` con texto y enlaces a las fotos; **no adjunta automáticamente imágenes como archivos multimedia**. Para mandar las fotos como imágenes individuales, usar el envío desde una conversación WhatsApp del CRM.

### Configuración y pruebas

- Configurar `PUBLIC_APP_URL` con el origen HTTPS público para la carga de fotos.
- Configurar `EVOLUTION_API_URL` y `EVOLUTION_API_KEY` únicamente como secretos del servidor, con la política HTTP/HTTPS definida para la instancia.
- Probar con un artículo de 3 fotos: guardar, cerrar y volver a abrir **Editar** para comprobar la galería; enviar desde una conversación de prueba y verificar los tres mensajes multimedia y sus textos.
- Comprobar el comportamiento ante un fallo en la segunda imagen para evitar duplicados al reintentar.

### Recepcionista IA: marca blanca y alcance actual

El panel de **Recepcionista IA** se presenta con marca propia en español, portugués e inglés. La integración actual es preparatoria: guarda configuración no secreta por empresa, pero **no conecta todavía un proveedor de respuestas automáticas ni comparte la sesión QR**. No cargar tokens privados en el panel ni habilitar una segunda conexión WhatsApp para el mismo número sin verificar la compatibilidad técnica.


## Motor de automatizaciones internas (Coolify)

El CRM incluye un motor de seguimiento que **crea tareas internas**; no envía WhatsApp, correo ni SMS.

Para habilitarlo en el servicio Node persistente de Coolify, configurar estas variables de entorno:

```env
CRM_AUTOMATIONS_ENABLED=true
CRM_AUTOMATIONS_SCHEDULER=true
CRM_AUTOMATIONS_INTERVAL_MINUTES=15
```

Reiniciar o redesplegar el servicio tras guardar las variables. El intervalo permitido es de 5 a 1440 minutos; se ejecuta una vez al iniciar y luego periódicamente. Sin estas variables, el motor permanece desactivado. Para desactivarlo, usar `CRM_AUTOMATIONS_ENABLED=false`.

Desde Automatizaciones, crear una regla de **contacto inactivo** o **estado de oportunidad**, y activarla explícitamente. El motor evalúa los días configurados y crea tareas para contactos con responsable asignado. Las reglas manuales no se ejecutan automáticamente. El motor registra ejecuciones para evitar duplicados diarios y evita crear otra tarea mientras la anterior siga pendiente. Si existen múltiples réplicas, se recomienda un único scheduler o un cron externo: la tabla de ejecuciones mitiga duplicados, pero el motor no proporciona coordinación distribuida integral.

También existe el endpoint privado `POST /api/internal/automation-run` para un scheduler externo. Requiere `Authorization: Bearer <CAMPAIGN_WORKER_SECRET>`, con secreto de al menos 24 caracteres. No exponer el secreto al navegador.

**Importante:** comprobar que las migraciones de la base de datos estén aplicadas, incluida `crm_automation_executions`, antes de habilitar el motor. Supervisar logs de Coolify tras activarlo.


### Telegram — avisos privados del owner

En Coolify, configurá las variables **runtime** `TELEGRAM_BOT_TOKEN` (token nuevo generado en BotFather, nunca en el repositorio) y `TELEGRAM_CHAT_ID` (ID del chat destinatario; si se omite se usa el ID proporcionado durante la configuración inicial). Redeploy después de agregarlas. Ejecutá `npm run db:migrate` una vez para crear `public.crm_telegram_settings`.

En **Configuración → Telegram** (solo owner) seleccioná y guardá los eventos `new_opportunity`, `security_access` y `new_contact`, activá los avisos y probá **Enviar mensaje de prueba**. Los avisos están desactivados por empresa hasta que un owner los habilite expresamente, para evitar filtraciones entre empresas. Los eventos de acceso incluyen inicios de sesión correctos y creación/modificación de usuarios; no incluyen contraseñas, tokens ni intentos fallidos sin identificación segura de empresa. El envío se realiza desde el servidor y los errores del proveedor no bloquean la operación comercial.


**Grupo Telegram editable:** el ID inicial de destino es `-5468425894`. El owner puede cambiarlo en Configuración → Telegram, guardar y luego enviar una prueba. La preferencia por empresa tiene prioridad sobre `TELEGRAM_CHAT_ID`; el token del bot continúa únicamente en variables de entorno. Ejecutá `npm run db:migrate` para incorporar la columna `chat_id` a instalaciones existentes.
