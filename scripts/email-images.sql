-- Run on production PostgreSQL before using the email image library.
CREATE TABLE IF NOT EXISTS public.crm_email_images (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
 uploaded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
 mime text NOT NULL CHECK (mime IN ('image/jpeg','image/png','image/webp','image/gif')),
 content bytea NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_email_images_company_created_idx ON public.crm_email_images(company_id,created_at DESC);
-- Public images are intended for email recipients; do not store sensitive images.
-- Enable RLS and explicitly allow tenant-scoped reads/writes to the app DB role
-- if TENANT_RLS_ENABLED is active in this deployment.
