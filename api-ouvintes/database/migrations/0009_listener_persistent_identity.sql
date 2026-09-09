-- Persistent listener identity is additive. The legacy registration table remains
-- as a campaign-level projection for the existing panel and exports.

CREATE TABLE IF NOT EXISTS listener_identity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  provider varchar(20) NOT NULL DEFAULT 'anonymous',
  provider_subject varchar(255),
  clerk_user_id varchar(255),
  status varchar(20) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT listener_identity_provider_check
    CHECK (provider IN ('anonymous', 'clerk', 'phone', 'email')),
  CONSTRAINT listener_identity_status_check
    CHECK (status IN ('active', 'unclaimed', 'disabled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS listener_identity_tenant_clerk_unique
  ON listener_identity (tenant_id, clerk_user_id)
  WHERE clerk_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS listener_identity_tenant_provider_subject_unique
  ON listener_identity (tenant_id, provider, provider_subject)
  WHERE provider_subject IS NOT NULL;

CREATE INDEX IF NOT EXISTS listener_identity_tenant_status_idx
  ON listener_identity (tenant_id, status);

ALTER TABLE listener_profile
  ADD COLUMN IF NOT EXISTS listener_identity_id uuid,
  ADD COLUMN IF NOT EXISTS phone_hash varchar(64),
  ADD COLUMN IF NOT EXISTS email varchar(320),
  ADD COLUMN IF NOT EXISTS gender varchar(40),
  ADD COLUMN IF NOT EXISTS age_range varchar(40),
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

ALTER TABLE listener_device
  ADD COLUMN IF NOT EXISTS listener_identity_id uuid;

-- Promote historical campaign registrations with a phone into one reusable
-- profile before creating the identity links below.
INSERT INTO listener_profile (
  tenant_id,
  name,
  neighborhood,
  city,
  phone,
  phone_normalized,
  status,
  marketing_opt_in
)
SELECT DISTINCT ON (registration.tenant_id, registration.phone_normalized)
       registration.tenant_id,
       registration.name,
       registration.neighborhood,
       registration.city,
       registration.phone,
       registration.phone_normalized,
       'active',
       registration.marketing_opt_in
  FROM listener_registration registration
 WHERE registration.deleted_at IS NULL
   AND registration.phone_normalized IS NOT NULL
   AND NOT EXISTS (
     SELECT 1
       FROM listener_profile profile
      WHERE profile.tenant_id = registration.tenant_id
        AND profile.phone_normalized = registration.phone_normalized
        AND profile.deleted_at IS NULL
   )
 ORDER BY registration.tenant_id, registration.phone_normalized, registration.created_at, registration.id;

-- Existing profiles are kept as unclaimed anonymous identities. The subject is
-- an internal identifier, never a raw device token or a Clerk token.
INSERT INTO listener_identity (tenant_id, provider, provider_subject, status)
SELECT p.tenant_id, 'anonymous', 'legacy-profile:' || p.id::text, 'unclaimed'
  FROM listener_profile p
 WHERE NOT EXISTS (
   SELECT 1
     FROM listener_identity i
    WHERE i.tenant_id = p.tenant_id
      AND i.provider = 'anonymous'
      AND i.provider_subject = 'legacy-profile:' || p.id::text
 );

UPDATE listener_profile p
   SET listener_identity_id = i.id
  FROM listener_identity i
 WHERE p.listener_identity_id IS NULL
   AND i.tenant_id = p.tenant_id
   AND i.provider = 'anonymous'
   AND i.provider_subject = 'legacy-profile:' || p.id::text;

-- The pre-CRM implementation could create one profile per campaign. Collapse
-- active profiles sharing a normalized phone before enforcing global uniqueness.
CREATE TEMP TABLE listener_profile_duplicate_map ON COMMIT DROP AS
SELECT duplicate_profile.id AS duplicate_id,
       canonical_profile.id AS canonical_id
  FROM listener_profile duplicate_profile
  JOIN LATERAL (
    SELECT p.id
      FROM listener_profile p
     WHERE p.tenant_id = duplicate_profile.tenant_id
       AND p.phone_normalized = duplicate_profile.phone_normalized
       AND p.phone_normalized IS NOT NULL
       AND p.deleted_at IS NULL
     ORDER BY p.created_at, p.id
     LIMIT 1
  ) canonical_profile ON true
 WHERE duplicate_profile.deleted_at IS NULL
   AND duplicate_profile.phone_normalized IS NOT NULL
   AND duplicate_profile.id <> canonical_profile.id;

DELETE FROM campaign_participation duplicate_participation
 USING listener_profile_duplicate_map duplicate_map
 WHERE duplicate_participation.listener_profile_id = duplicate_map.duplicate_id
   AND EXISTS (
     SELECT 1
       FROM campaign_participation canonical_participation
      WHERE canonical_participation.tenant_id = duplicate_participation.tenant_id
        AND canonical_participation.campaign_id = duplicate_participation.campaign_id
        AND canonical_participation.listener_profile_id = duplicate_map.canonical_id
   );

UPDATE campaign_participation participation
   SET listener_profile_id = duplicate_map.canonical_id
  FROM listener_profile_duplicate_map duplicate_map
 WHERE participation.listener_profile_id = duplicate_map.duplicate_id;

UPDATE listener_device device
   SET listener_profile_id = duplicate_map.canonical_id,
       listener_identity_id = canonical_profile.listener_identity_id
  FROM listener_profile_duplicate_map duplicate_map
  JOIN listener_profile canonical_profile
    ON canonical_profile.id = duplicate_map.canonical_id
 WHERE device.listener_profile_id = duplicate_map.duplicate_id;

UPDATE listener_profile duplicate_profile
   SET status = 'merged',
       deleted_at = COALESCE(duplicate_profile.deleted_at, now())
  FROM listener_profile_duplicate_map duplicate_map
 WHERE duplicate_profile.id = duplicate_map.duplicate_id;

UPDATE listener_device device
   SET listener_identity_id = profile.listener_identity_id
  FROM listener_profile profile
 WHERE device.listener_identity_id IS NULL
   AND device.listener_profile_id = profile.id;

ALTER TABLE listener_profile
  ALTER COLUMN listener_identity_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'listener_profile_identity_fk'
  ) THEN
    ALTER TABLE listener_profile
      ADD CONSTRAINT listener_profile_identity_fk
      FOREIGN KEY (listener_identity_id) REFERENCES listener_identity(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'listener_device_identity_fk'
  ) THEN
    ALTER TABLE listener_device
      ADD CONSTRAINT listener_device_identity_fk
      FOREIGN KEY (listener_identity_id) REFERENCES listener_identity(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS listener_profile_phone_hash_idx
  ON listener_profile (phone_hash);

CREATE UNIQUE INDEX IF NOT EXISTS listener_profile_tenant_phone_unique
  ON listener_profile (tenant_id, phone_normalized)
  WHERE phone_normalized IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS listener_consent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  listener_profile_id uuid NOT NULL REFERENCES listener_profile(id) ON DELETE RESTRICT,
  consent_type varchar(40) NOT NULL,
  document_version varchar(40),
  granted boolean NOT NULL,
  source varchar(50) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS listener_consent_profile_created_idx
  ON listener_consent (tenant_id, listener_profile_id, created_at DESC);

CREATE TABLE IF NOT EXISTS listener_communication_preference (
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  listener_profile_id uuid NOT NULL REFERENCES listener_profile(id) ON DELETE CASCADE,
  receive_portal_news boolean NOT NULL DEFAULT false,
  receive_campaign_updates boolean NOT NULL DEFAULT false,
  receive_email boolean NOT NULL DEFAULT false,
  receive_whatsapp boolean NOT NULL DEFAULT false,
  email_verified_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, listener_profile_id)
);

INSERT INTO listener_communication_preference (tenant_id, listener_profile_id)
SELECT p.tenant_id, p.id
  FROM listener_profile p
 WHERE NOT EXISTS (
   SELECT 1
     FROM listener_communication_preference preference
    WHERE preference.tenant_id = p.tenant_id
      AND preference.listener_profile_id = p.id
 );

CREATE TABLE IF NOT EXISTS listener_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  listener_identity_id uuid REFERENCES listener_identity(id) ON DELETE SET NULL,
  listener_profile_id uuid REFERENCES listener_profile(id) ON DELETE SET NULL,
  event_type varchar(80) NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS listener_activity_tenant_created_idx
  ON listener_activity_log (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS listener_activity_profile_created_idx
  ON listener_activity_log (listener_profile_id, created_at DESC);

DROP TRIGGER IF EXISTS listener_identity_set_updated_at ON listener_identity;
CREATE TRIGGER listener_identity_set_updated_at
BEFORE UPDATE ON listener_identity
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS listener_communication_preference_set_updated_at
  ON listener_communication_preference;
CREATE TRIGGER listener_communication_preference_set_updated_at
BEFORE UPDATE ON listener_communication_preference
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
