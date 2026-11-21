-- Missing client reminder queue: PostgreSQL 42P01 during dispatchAppointmentReminders.
CREATE TABLE IF NOT EXISTS public.crm_appointment_reminders (
 id bigserial PRIMARY KEY,
 company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
 appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
 offset_minutes integer NOT NULL CHECK (offset_minutes IN (10,60,180)),
 due_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed','skipped')),
 sent_at timestamptz,
 external_id text,
 error_code text,
 UNIQUE (appointment_id,offset_minutes)
);
CREATE INDEX IF NOT EXISTS crm_appointment_reminders_due_idx ON public.crm_appointment_reminders(due_at) WHERE status='pending';
REVOKE ALL ON public.crm_appointment_reminders FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.crm_appointment_reminders_id_seq FROM PUBLIC;
-- Application's DATABASE_URL role needs SELECT/INSERT/UPDATE and sequence USAGE.
