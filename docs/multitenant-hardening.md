# Seguridad multitenant — despliegue gradual

## Estado
El backend ya filtra los datos de negocio por `req.user.company_id`. La nueva ruta `GET /api/company` muestra solo la empresa del usuario autenticado; `PATCH /api/company` permite cambiar su nombre únicamente a `owner`. No existe un superadministrador global en esta implementación.

## Aplicación de restricciones de integridad
1. Crear una copia de seguridad de PostgreSQL.
2. Ejecutar `scripts/tenant_preflight.sql`. Todas las filas deben mostrar `violations = 0`. Si aparecen valores distintos de cero, investigar y corregir manualmente sin mover ni eliminar registros automáticamente.
3. Ejecutar `scripts/tenant_integrity.sql` en una ventana de mantenimiento. Las restricciones `NOT VALID` bloquean nuevas referencias cruzadas, pero no certifican los datos históricos.
4. Validar las restricciones con `ALTER TABLE <tabla> VALIDATE CONSTRAINT <nombre>;` una a una. Revisar posibles referencias de entidades adicionales antes de activar RLS.

## RLS — pendiente, NO activar directamente
El pool de PostgreSQL usa una cuenta compartida y consultas independientes. Activar RLS sin un contexto de tenant establecido por transacción podría bloquear la aplicación o dejar aislamiento insuficiente. Antes de habilitarlo:
- Implementar un wrapper transaccional que establezca `SET LOCAL app.company_id` a partir de la sesión JWT validada.
- Migrar todas las consultas autenticadas al wrapper y separar los flujos de login, health y webhooks.
- Configurar un rol de aplicación sin `BYPASSRLS` y verificar que no sea dueño de las tablas.
- Crear políticas `USING` y `WITH CHECK` por tenant para todas las tablas, incluidas las tablas hijas sin `company_id` directo.
- Probar dos empresas con IDs cruzados para GET, POST, PATCH, webhooks, mensajes y archivos.
- Habilitar `FORCE ROW LEVEL SECURITY` solo después de verificar rol, políticas y pruebas.

## Limitaciones actuales
No se han ejecutado migraciones en la base de datos de producción ni pruebas de aislamiento en un entorno conectado. No afirmar que RLS está activo. El aprovisionamiento de empresas nuevas y un panel global de administración requieren un diseño separado de permisos.
