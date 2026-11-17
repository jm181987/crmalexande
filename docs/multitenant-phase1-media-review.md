# Fase 1b — hallazgo de seguridad: enlaces públicos de multimedia

## Confirmado en código (no verificado aún en producción)
- `scripts/whatsapp.sql` define `crm_public_chat_media(uuid)` como `SECURITY DEFINER`, con `search_path=public`, y concede `EXECUTE` a `PUBLIC`. La función selecciona por UUID sin filtrar `company_id`.
- `scripts/inventory.sql` hace lo mismo para `crm_public_inventory_image(uuid)`.
- `server/evolution-instances.js` sirve `GET /api/public/chat-media/:id` sin sesión; `server/inventory.js` sirve `GET /api/public/inventory-image/:id` sin sesión. En ambos casos la función privilegiada devuelve los bytes por ID.
- Esto es un **enlace de capacidad**: conocer el UUID puede bastar para recuperar contenido de otra empresa, aunque no se puedan enumerar IDs fácilmente. No se debe afirmar aislamiento total de archivos por RLS.
- Ya existe una ruta autenticada para multimedia de conversaciones en `server/evolution-instances.js`. La compatibilidad con Evolution API y enlaces compartidos exige diseñar por separado los casos públicos.

## Decisión segura antes de cambiar producción
No revocar `PUBLIC EXECUTE` ni eliminar rutas públicas sin revisar el flujo de Evolution API y enlaces enviados: podría romper imágenes ya compartidas.

### Diseño recomendado para siguiente PR
1. Chat privado: usar ruta autenticada y validar conversación, empresa y rol. Migrar URLs del frontend.
2. Medios compartidos externos: tokens aleatorios de corta duración, asociados a empresa y archivo; almacenamiento de hash, expiración, revocación, auditoría y controles de acceso; no exponer UUID de almacenamiento como autorización.
3. Evitar funciones `SECURITY DEFINER` accesibles públicamente que devuelvan bytes por UUID. Aplicar `SET search_path=pg_catalog, public` y nombres de objetos cualificados, después de probar compatibilidad.
4. Registrar emisión y uso de tokens de soporte, con actor, empresa, motivo y vencimiento; no reutilizar los tokens de multimedia para acceso administrativo.
5. Probar desde dos empresas y una sesión anónima que las rutas privadas niegan acceso a archivos ajenos; verificar expresamente el comportamiento de enlaces públicos.

## Cómo continuar
Ejecutar `scripts/multitenant_phase1_media_audit.sql` y compartir resultados (sin bytes ni secretos), junto con las tablas de roles y RLS del primer informe. Este PR no cambia permisos, esquema, rutas ni datos.
