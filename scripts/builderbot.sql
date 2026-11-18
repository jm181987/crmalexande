CREATE TABLE IF NOT EXISTS public.crm_builderbot_settings (
 company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
 bot_id uuid NOT NULL,
 api_key_encrypted text NOT NULL,
 webhook_token_hash text NOT NULL,
 assistant_answer_id uuid,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_builderbot_settings_bot_id_idx ON public.crm_builderbot_settings(bot_id);
CREATE TABLE IF NOT EXISTS public.crm_builderbot_webhook_events (
 id bigserial PRIMARY KEY,
 company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
 bot_id uuid NOT NULL,
 event_hash text NOT NULL,
 payload jsonb NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,event_hash)
);
CREATE INDEX IF NOT EXISTS crm_builderbot_events_company_idx ON public.crm_builderbot_webhook_events(company_id,received_at DESC);
-- Backend DB role only: never expose encrypted credentials or webhook payloads through public database APIs.
