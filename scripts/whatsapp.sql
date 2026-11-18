BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_messages_external ON messages(external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_lookup ON conversations(company_id,channel,external_id);
COMMIT;

CREATE TABLE IF NOT EXISTS crm_chat_media(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 mime text NOT NULL,
 filename text NOT NULL,
 content bytea NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE crm_chat_media ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chat_media_tenant ON crm_chat_media;
CREATE POLICY chat_media_tenant ON crm_chat_media FOR ALL
 USING (company_id=NULLIF(current_setting('app.company_id',true),'')::uuid)
 WITH CHECK (company_id=NULLIF(current_setting('app.company_id',true),'')::uuid);
CREATE OR REPLACE FUNCTION public.crm_public_chat_media(p_id uuid)
RETURNS TABLE(mime text,filename text,content bytea)
LANGUAGE sql SECURITY DEFINER SET search_path=public
AS $$ SELECT m.mime,m.filename,m.content FROM public.crm_chat_media m WHERE m.id=p_id LIMIT 1 $$;
REVOKE ALL ON FUNCTION public.crm_public_chat_media(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_public_chat_media(uuid) TO PUBLIC;

ALTER TABLE crm_chat_media ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ready';
ALTER TABLE crm_chat_media ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL;
ALTER TABLE crm_chat_media ADD COLUMN IF NOT EXISTS uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE crm_chat_media ADD COLUMN IF NOT EXISTS size_bytes bigint NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_crm_chat_media_company_created ON crm_chat_media(company_id,created_at DESC);

-- One outbound WhatsApp provider per tenant. Existing tenants default to Evolution.
CREATE TABLE IF NOT EXISTS public.crm_whatsapp_provider_settings (
 company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
 provider text NOT NULL DEFAULT 'evolution' CHECK (provider IN ('evolution','builderbot')),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_whatsapp_provider_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crm_whatsapp_provider_tenant ON public.crm_whatsapp_provider_settings;
CREATE POLICY crm_whatsapp_provider_tenant ON public.crm_whatsapp_provider_settings FOR ALL
 USING (company_id=NULLIF(current_setting('app.company_id',true),'')::uuid)
 WITH CHECK (company_id=NULLIF(current_setting('app.company_id',true),'')::uuid);
