-- Ejecutar una vez en la base de datos PostgreSQL de producción.
-- No elimina conversaciones, sesiones, instancias ni mensajes.
CREATE TABLE IF NOT EXISTS public.crm_evolution_connection_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 instance_id uuid NOT NULL REFERENCES public.crm_evolution_instances(id) ON DELETE CASCADE,
 company_id uuid NOT NULL REFERENCES public.companies(id),
 state text NOT NULL,
 source text NOT NULL CHECK (source IN ('webhook','poll')),
 recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_evolution_connection_events ON public.crm_evolution_connection_events(instance_id,recorded_at DESC);
-- Confirmar:
SELECT to_regclass('public.crm_evolution_connection_events') AS historial_evolution;
