ALTER TABLE listener_registration
ADD COLUMN IF NOT EXISTS phone_normalized varchar(20);

UPDATE listener_registration
SET phone_normalized = NULLIF(regexp_replace(phone, '\D', '', 'g'), '')
WHERE phone IS NOT NULL
  AND phone_normalized IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS listener_registration_campaign_phone_unique
ON listener_registration (campaign_id, phone_normalized)
WHERE phone_normalized IS NOT NULL
  AND deleted_at IS NULL;
