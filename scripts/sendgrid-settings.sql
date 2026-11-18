CREATE TABLE IF NOT EXISTS public.crm_sendgrid_settings (
 company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
 api_key_ciphertext text NOT NULL,
 from_email text NOT NULL,
 reply_to text,
 updated_at timestamptz NOT NULL DEFAULT now()
);
-- Restrict access to this table to the backend database role; never expose ciphertext through a public API.
