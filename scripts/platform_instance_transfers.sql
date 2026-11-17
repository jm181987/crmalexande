CREATE TABLE IF NOT EXISTS public.crm_platform_instance_transfers (
 id bigserial PRIMARY KEY,
 instance_id uuid NOT NULL REFERENCES public.crm_evolution_instances(id),
 source_company_id uuid NOT NULL REFERENCES public.companies(id),
 destination_company_id uuid NOT NULL REFERENCES public.companies(id),
 admin_user_id uuid NOT NULL REFERENCES public.users(id),
 conversation_count integer NOT NULL,
 contact_count integer NOT NULL,
 message_count integer NOT NULL,
 media_count integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
