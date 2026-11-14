# Estado de RLS multitenant

## Implementado en el código
- `server/db.js`: `tenantContext` con AsyncLocalStorage. Con `TENANT_DB_CONTEXT=true`, cada `query()` en contexto de empresa ejecuta `BEGIN`, `set_config('app.company_id',...,true)`, la consulta y `COMMIT` usando el mismo cliente. Sin contexto, conserva el comportamiento anterior.
- `server/index.js`: después de verificar JWT y cargar el usuario desde la base, establece el contexto usando `company_id` del usuario verificado.
- `server/evolution-instances.js`: después de verificar el secreto del webhook, establece el contexto usando la empresa de la instancia.
- `scripts/tenant_rls_policies_prepare.sql`: políticas RLS definidas pero NO activadas.

## NO activar RLS aún
1. Login consulta `users` sin tenant conocido, y webhooks buscan `crm_evolution_instances` por secreto sin tenant. Esas rutas requieren un diseño separado con permisos mínimos o funciones SECURITY DEFINER revisadas.
2. El pool de PostgreSQL puede utilizar un rol propietario de tablas o BYPASSRLS. Validar con:
   `SELECT current_user, rolbypassrls, rolsuper FROM pg_roles WHERE rolname=current_user;`
3. La consulta de auth a `users` y la consulta inicial del webhook quedan fuera del contexto de tenant. No habilitar RLS para estas tablas sin migrarlas primero.
4. Probar en staging con dos empresas y con un rol de aplicación sin BYPASSRLS. Verificar operaciones de login, dashboard, contactos, oportunidades, tareas, mensajes, Evolution, reportes y todos los módulos.
5. No activar `FORCE ROW LEVEL SECURITY` hasta completar pruebas.
6. El script de políticas crea políticas para las tablas de negocio y para tablas hijas `stages` y `messages`; revisar cualquier tabla agregada en futuras migraciones.

## Orden de ejecución
- Respaldar DB y verificar integridad (las 11 FK ya se validaron).
- Desplegar el código con `TENANT_DB_CONTEXT` sin definir (modo compatible).
- En staging, configurar `TENANT_DB_CONTEXT=true` y probar todas las rutas.
- Ejecutar `scripts/tenant_rls_policies_prepare.sql` primero solo en staging.
- Implementar estrategia segura para login y webhook sin contexto.
- Preparar rol SQL con privilegios mínimos, crear pruebas de aislamiento y activar RLS gradualmente en staging.
- Solo después considerar producción.

## Nota
No se han aplicado las políticas SQL a PostgreSQL ni se han probado contra la base de datos de producción. El modo de contexto de transacción por consulta agrega una transacción por sentencia y puede aumentar el costo de conexión; medir rendimiento antes de habilitarlo en producción.
