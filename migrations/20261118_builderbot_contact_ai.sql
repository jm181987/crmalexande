-- Individual BuilderBot AI state. Evolution API conversations remain untouched.
CREATE TABLE IF NOT EXISTS public.crm_builderbot_contact_ai (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  phone text NOT NULL CHECK (phone ~ '^[0-9]{8,15}$'),
  paused boolean NOT NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, phone)
);
CREATE INDEX IF NOT EXISTS crm_builderbot_contact_ai_updated_idx
  ON public.crm_builderbot_contact_ai(company_id, updated_at DESC);
