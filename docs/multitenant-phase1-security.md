# ZARKO CRM — Fase 1: auditoría de seguridad multitenant

## Alcance
Esta fase **no crea superadmin ni permite acceso cruzado**. Establece el inventario de aislamiento antes de introducir un plano de control global. La identidad de superadmin debe vivir fuera de `users.role` (actualmente owner/manager/agent), con autorización explícita, caducidad, motivo y auditoría inmutable para cada sesión de soporte.

## Hallazgos de revisión estática
1. La API usa `req.user.company_id` y `tenantContext.enterWith` tras autenticar; `server/db.js` aplica `set_config('app.company_id',...,true)` dentro de una transacción por consulta.
2. `scripts/tenant_rls_activate.sql` contiene políticas y funciones de autenticación SECURITY DEFINER. **La presencia del script no demuestra que RLS esté activo en producción.**
3. `scripts/tenant_rls_policies_prepare.sql` es una versión preparatoria más antigua; no ejecutarla sobre políticas activas sin revisar el efecto de reemplazo.
4. Las rutas de login, webhooks y workers requieren contexto especial sin sesión tenant. Nunca permitir que un identificador de empresa enviado por el cliente establezca el contexto.
5. `server/index.js` autoriza creación y edición de usuarios por owner y limita los roles a owner/manager/agent. No convertir owner en superadmin.
6. `scripts/tenant_integrity.sql` agrega FKs compuestas NOT VALID; comprobar previamente `scripts/tenant_preflight.sql` y verificar cuáles constraints ya existen.
7. Revisar en producción el aislamiento de tablas sin `company_id` directo (p. ej. mensajes relacionados con conversaciones), archivos multimedia, integraciones y registros de ejecución.
8. Los procesos en segundo plano deben tener estrategia explícita para iterar empresas sin depender de permisos globales indiscriminados.

## Procedimiento seguro
1. Hacer backup de PostgreSQL y verificar restauración en staging.
2. Ejecutar **solo lectura** `scripts/multitenant_phase1_audit.sql` y `scripts/tenant_preflight.sql` como DBA.
3. Revisar resultados: cero referencias cruzadas, roles de aplicación sin SUPERUSER/BYPASSRLS, políticas completas y pruebas por dos empresas distintas.
4. Ejecutar `scripts/tenant_rls_smoke_test.sql` únicamente en un entorno de pruebas configurado con IDs reales. Probar A, B y ausencia de contexto en transacciones separadas.
5. Documentar rutas que hacen consultas sin tenant, consultas a tablas derivadas y tareas de background antes de cambios de permisos.
6. No ejecutar scripts de activación RLS en producción hasta validar las rutas y preparar rollback.

## Criterios de aceptación de fase 1
- Inventario de tablas, políticas, funciones SECURITY DEFINER y roles revisado.
- Cero referencias cruzadas o plan de remediación documentado.
- Pruebas negativas A→B y B→A para API, multimedia, inventario y WhatsApp.
- Diseño de acceso de soporte: solicitud con motivo y ticket, aprobación, caducidad, auditoría de acciones y revocación; **sin acceso silencioso**.
- Fase 2 solo tras validar los resultados de producción.

## Importante
No ejecutar el archivo de auditoría esperando cambios de esquema: no realiza mutaciones. Los resultados de producción aún no están disponibles en este PR.
