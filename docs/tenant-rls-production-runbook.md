# Alexandre CRM — activación segura de RLS

## Cambios incluidos
- `server/db.js`: contexto de tenant por transacción con `SET LOCAL` si `TENANT_DB_CONTEXT=true`.
- `server/index.js`: autenticación por funciones SQL de acceso limitado cuando `TENANT_RLS_ENABLED=true`.
- `server/evolution-instances.js`: resolución inicial del webhook mediante función SQL de acceso limitado, seguida de consultas con contexto de empresa.
- `scripts/tenant_rls_activate.sql`: crea las funciones, restringe EXECUTE al usuario del CRM y habilita RLS para las 18 tablas.
- `scripts/tenant_rls_smoke_test.sql`: prueba de aislamiento sin modificaciones.

## Importante: NO se ha activado RLS en producción
La migración SQL de activación no se ha ejecutado ni se ha comprobado en staging. El commit por sí solo NO activa RLS. La aplicación necesita `TENANT_RLS_ENABLED=true` y `TENANT_DB_CONTEXT=true` cuando la migración ya está aplicada. Coordinar el cambio con una ventana de mantenimiento para evitar solicitudes entre estados incompatibles.

## Secuencia recomendada
1. Rotar inmediatamente la contraseña de PostgreSQL expuesta y actualizar `DATABASE_URL` en Vercel. No compartir la nueva cadena.
2. Respaldar PostgreSQL. Verificar que la conexión del CRM utiliza `knj_crm_alexandre_crm_usr` y que este rol no tiene BYPASSRLS.
3. Probar el código y `scripts/tenant_rls_activate.sql` en staging con una copia saneada de datos. Usar una cuenta administradora para ejecutar el SQL.
4. Activar ambas variables de entorno en staging y desplegar. Probar login, `/api/auth/me`, empresas, usuarios, dashboard, contactos, oportunidades, tareas, citas, reportes, mensajes, Evolution API y webhooks.
5. Ejecutar `scripts/tenant_rls_smoke_test.sql` en staging y probar que dos empresas no puedan consultar ni editar datos cruzados.
6. En producción, establecer ventana de mantenimiento, desplegar código compatible, aplicar la migración SQL y activar ambas variables en el mismo corte coordinado; hacer redeploy y repetir pruebas.
7. Si falla, restaurar primero la combinación anterior de código/configuración y desactivar RLS de forma controlada, no solamente apagar los flags. Evitar operar con RLS activo y flags apagados.

## Riesgos y limitaciones
- Las funciones SECURITY DEFINER deben ser creadas por `postgres` y auditadas; devuelven información únicamente al rol SQL de la aplicación, no al usuario final.
- Las políticas se basan en `app.company_id`, que solo el backend debe establecer desde una sesión verificada. No aceptar `company_id` suministrado por el cliente.
- `SET LOCAL` solo funciona dentro de una transacción; cada consulta del backend abre su propia transacción cuando el flag está activo. Revisar rendimiento.
- Las 18 tablas tienen políticas, pero el acceso efectivo aún necesita pruebas con dos empresas y verificación de rutas no cubiertas.
- No se ha comprobado el despliegue de Vercel ni ejecutado pruebas de integración contra PostgreSQL en esta sesión.
