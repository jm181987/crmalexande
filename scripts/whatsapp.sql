BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_messages_external ON messages(external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_lookup ON conversations(company_id,channel,external_id);
COMMIT;
