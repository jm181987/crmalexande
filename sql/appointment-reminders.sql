-- Apply before enabling appointment reminders. Opt-in per appointment.
CREATE TABLE IF NOT EXISTS crm_appointment_reminders (
 id bigserial PRIMARY KEY,
 company_id uuid NOT NULL,
 appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
 offset_minutes integer NOT NULL CHECK (offset_minutes IN (180,60,10)),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed','skipped')),
 due_at timestamptz NOT NULL,
 sent_at timestamptz,
 external_id text,
 error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (appointment_id,offset_minutes)
);
CREATE INDEX IF NOT EXISTS crm_appointment_reminders_due_idx ON crm_appointment_reminders (due_at) WHERE status='pending';
