# ZARKO CRM — despliegue gradual de protección multimedia

## Alcance del PR
Se añade un mecanismo opcional de firma HMAC-SHA256 para las rutas públicas de multimedia. No se habilita automáticamente, no modifica SQL ni habilita RLS en conversaciones/mensajes. **No equivale a aislamiento multitenant completo.**

## Riesgo actual
Las funciones `crm_public_chat_media` y `crm_public_inventory_image` son SECURITY DEFINER, propiedad de postgres y ejecutables por PUBLIC. Recuperan bytes por UUID sin comprobar empresa. Las rutas públicas de Node usan esas funciones.

## Modo de compatibilidad (predeterminado)
Con `CRM_MEDIA_REQUIRE_SIGNATURE` ausente o distinto de `true`, las rutas siguen siendo públicas por UUID, para evitar romper fotos existentes. **Este modo NO corrige la exposición de archivos.**

## Modo protegido (NO activar en producción todavía)
Variables: `CRM_MEDIA_SIGNING_SECRET` (valor aleatorio >=32 caracteres, mismo en todas las réplicas) y `CRM_MEDIA_REQUIRE_SIGNATURE=true`.
Las rutas públicas exigen `exp` y `sig`, vinculadas a tipo de archivo y UUID, con vencimiento. Las URL emitidas para chat llevan 24 horas; las nuevas URLs de inventario, 7 días.

**Limitación de migración:** URLs de inventario y mensajes existentes contienen UUID sin firma y dejan de funcionar en modo protegido. También deben revisarse las validaciones de URLs de galerías de inventario, el historial y los accesos del navegador antes de activar. Las URL firmadas son enlaces de capacidad: quien posea el enlace puede usarlo hasta su vencimiento; no se audita cada lectura ni se revoca individualmente. No son un sustituto del control de sesión para multimedia privada.

## Checklist previo a activar
1. Preparar staging con datos de prueba y backup.
2. Probar envío y recepción de imágenes, audios y documentos en Evolution API.
3. Probar galería de Stock, imágenes guardadas previamente, mensajes históricos y visualización del chat.
4. Migrar referencias existentes a un modelo de acceso autenticado o reemisión de enlaces; agregar revocación y auditoría.
5. Confirmar que los usuarios anónimos y los usuarios de otra empresa no puedan obtener URLs firmadas de contenido ajeno.
6. Auditar RLS de conversaciones/mensajes, consultas sin contexto y workers antes de activar políticas.
7. Solo entonces coordinar activación con rollback.

## Nota
Este PR es una preparación técnica. No ejecutar SQL de cambios ni habilitar el flag en producción con el estado actual.
