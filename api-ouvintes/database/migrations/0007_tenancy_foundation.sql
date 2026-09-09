CREATE TABLE IF NOT EXISTS tenant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug varchar(100) NOT NULL,
  name varchar(180) NOT NULL,
  timezone varchar(80) NOT NULL DEFAULT 'America/Sao_Paulo',
  status varchar(20) NOT NULL DEFAULT 'active',
  settings_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_status_check CHECK (status IN ('active', 'suspended', 'archived'))
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_slug_unique_ci
  ON tenant (lower(slug));

INSERT INTO tenant (id, slug, name, timezone, status)
VALUES (
  '00000000-0000-4000-8000-000000000088',
  'radio-88',
  'Radio 88 FM',
  'America/Sao_Paulo',
  'active'
)
ON CONFLICT (lower(slug)) DO NOTHING;

CREATE OR REPLACE FUNCTION current_default_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT id FROM tenant WHERE slug = 'radio-88' LIMIT 1;
$$;

CREATE TABLE IF NOT EXISTS tenant_domain (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  hostname varchar(255) NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_domain_hostname_unique_ci
  ON tenant_domain (lower(hostname));
CREATE INDEX IF NOT EXISTS tenant_domain_tenant_idx
  ON tenant_domain (tenant_id, active);

CREATE TABLE IF NOT EXISTS tenant_admin_membership (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL REFERENCES admin_user(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES role(id) ON DELETE RESTRICT,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_admin_membership_unique
  ON tenant_admin_membership (admin_user_id, tenant_id, role_id);
CREATE INDEX IF NOT EXISTS tenant_admin_membership_active_idx
  ON tenant_admin_membership (admin_user_id, tenant_id, active);

CREATE TABLE IF NOT EXISTS tenant_feature_flag (
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  flag_key varchar(100) NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, flag_key),
  CONSTRAINT tenant_feature_flag_key_check CHECK (flag_key ~ '^[a-z0-9_:-]+$')
);

ALTER TABLE campaign
  ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT current_default_tenant_id();
ALTER TABLE listener_registration
  ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT current_default_tenant_id();
ALTER TABLE registration_export_audit
  ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT current_default_tenant_id();
ALTER TABLE campaign_placement
  ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT current_default_tenant_id();
ALTER TABLE listener_profile
  ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT current_default_tenant_id();
ALTER TABLE listener_device
  ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT current_default_tenant_id();
ALTER TABLE campaign_participation
  ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT current_default_tenant_id();
ALTER TABLE campaign_device_state
  ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT current_default_tenant_id();
ALTER TABLE sweepstake_draw
  ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT current_default_tenant_id();
ALTER TABLE sweepstake_draw_entry
  ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT current_default_tenant_id();
ALTER TABLE media_asset
  ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT current_default_tenant_id();
ALTER TABLE institutional_banner
  ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT current_default_tenant_id();
ALTER TABLE admin_audit_log
  ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT current_default_tenant_id();

UPDATE campaign SET tenant_id = current_default_tenant_id() WHERE tenant_id IS NULL;
UPDATE listener_registration SET tenant_id = current_default_tenant_id() WHERE tenant_id IS NULL;
UPDATE registration_export_audit SET tenant_id = current_default_tenant_id() WHERE tenant_id IS NULL;
UPDATE campaign_placement SET tenant_id = current_default_tenant_id() WHERE tenant_id IS NULL;
UPDATE listener_profile SET tenant_id = current_default_tenant_id() WHERE tenant_id IS NULL;
UPDATE listener_device SET tenant_id = current_default_tenant_id() WHERE tenant_id IS NULL;
UPDATE campaign_participation SET tenant_id = current_default_tenant_id() WHERE tenant_id IS NULL;
UPDATE campaign_device_state SET tenant_id = current_default_tenant_id() WHERE tenant_id IS NULL;
UPDATE sweepstake_draw SET tenant_id = current_default_tenant_id() WHERE tenant_id IS NULL;
UPDATE sweepstake_draw_entry SET tenant_id = current_default_tenant_id() WHERE tenant_id IS NULL;
UPDATE media_asset SET tenant_id = current_default_tenant_id() WHERE tenant_id IS NULL;
UPDATE institutional_banner SET tenant_id = current_default_tenant_id() WHERE tenant_id IS NULL;
UPDATE admin_audit_log SET tenant_id = current_default_tenant_id() WHERE tenant_id IS NULL;

ALTER TABLE campaign ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE listener_registration ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE registration_export_audit ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE campaign_placement ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE listener_profile ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE listener_device ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE campaign_participation ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE campaign_device_state ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE sweepstake_draw ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE sweepstake_draw_entry ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE media_asset ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE institutional_banner ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE admin_audit_log ALTER COLUMN tenant_id SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_device_state_pkey' AND conrelid = 'campaign_device_state'::regclass) THEN
    ALTER TABLE campaign_device_state DROP CONSTRAINT campaign_device_state_pkey;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_device_state_pkey' AND conrelid = 'campaign_device_state'::regclass) THEN
    ALTER TABLE campaign_device_state ADD CONSTRAINT campaign_device_state_pkey PRIMARY KEY (tenant_id, campaign_id, listener_device_id);
  END IF;
END $$;

DO $$
DECLARE
  table_name text;
  constraint_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'campaign',
    'listener_registration',
    'registration_export_audit',
    'campaign_placement',
    'listener_profile',
    'listener_device',
    'campaign_participation',
    'campaign_device_state',
    'sweepstake_draw',
    'sweepstake_draw_entry',
    'media_asset',
    'institutional_banner',
    'admin_audit_log'
  ] LOOP
    constraint_name := table_name || '_tenant_fk';
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = constraint_name
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE RESTRICT',
        table_name,
        constraint_name
      );
    END IF;
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS campaign_tenant_created_idx
  ON campaign (tenant_id, created_at DESC)
  WHERE archived_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS campaign_tenant_slug_unique
  ON campaign (tenant_id, lower(slug));
CREATE INDEX IF NOT EXISTS listener_registration_tenant_created_idx
  ON listener_registration (tenant_id, campaign_id, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS registration_export_audit_tenant_created_idx
  ON registration_export_audit (tenant_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS campaign_placement_tenant_key_unique
  ON campaign_placement (tenant_id, placement_key);
CREATE INDEX IF NOT EXISTS listener_profile_tenant_phone_idx
  ON listener_profile (tenant_id, phone_normalized)
  WHERE phone_normalized IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS listener_device_tenant_token_unique
  ON listener_device (tenant_id, token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS campaign_participation_tenant_profile_unique
  ON campaign_participation (tenant_id, campaign_id, listener_profile_id);
CREATE INDEX IF NOT EXISTS campaign_device_state_tenant_idx
  ON campaign_device_state (tenant_id, campaign_id, listener_device_id);
CREATE INDEX IF NOT EXISTS sweepstake_draw_tenant_campaign_idx
  ON sweepstake_draw (tenant_id, campaign_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS media_asset_tenant_object_key_unique
  ON media_asset (tenant_id, object_key);
CREATE INDEX IF NOT EXISTS institutional_banner_tenant_public_idx
  ON institutional_banner (tenant_id, placement_key, active, display_order)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS admin_audit_log_tenant_created_idx
  ON admin_audit_log (tenant_id, created_at DESC);

DO $$
DECLARE
  constraint_record record;
BEGIN
  FOR constraint_record IN
    SELECT c.conrelid::regclass AS table_name, c.conname
    FROM pg_constraint c
    WHERE c.contype = 'u'
      AND c.conrelid IN (
        'campaign'::regclass,
        'campaign_placement'::regclass,
        'media_asset'::regclass,
        'listener_device'::regclass
      )
      AND pg_get_constraintdef(c.oid) IN (
        'UNIQUE (slug)',
        'UNIQUE (placement_key)',
        'UNIQUE (object_key)',
        'UNIQUE (token_hash)'
      )
  LOOP
    EXECUTE format(
      'ALTER TABLE %s DROP CONSTRAINT %I',
      constraint_record.table_name,
      constraint_record.conname
    );
  END LOOP;
END $$;

DROP INDEX IF EXISTS campaign_slug_unique;
DROP INDEX IF EXISTS campaign_placement_key_unique;
DROP INDEX IF EXISTS media_asset_object_key_unique;
DROP INDEX IF EXISTS listener_device_token_hash_unique;

INSERT INTO tenant_feature_flag (tenant_id, flag_key, enabled)
SELECT id, flag_key, false
FROM tenant
CROSS JOIN unnest(ARRAY[
  'crm_v2',
  'programming',
  'polls',
  'push',
  'promotions_v2',
  'blog',
  'feed',
  'dashboard'
]) AS flags(flag_key)
ON CONFLICT (tenant_id, flag_key) DO NOTHING;

INSERT INTO tenant_admin_membership (admin_user_id, tenant_id, role_id)
SELECT au.id, t.id, r.id
FROM admin_user au
CROSS JOIN tenant t
JOIN role r ON r.key = CASE WHEN au.role = 'viewer' THEN 'auditor' ELSE 'admin' END
WHERE t.slug = 'radio-88'
ON CONFLICT (admin_user_id, tenant_id, role_id) DO NOTHING;

DROP TRIGGER IF EXISTS tenant_set_updated_at ON tenant;
CREATE TRIGGER tenant_set_updated_at
BEFORE UPDATE ON tenant
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS tenant_domain_set_updated_at ON tenant_domain;
CREATE TRIGGER tenant_domain_set_updated_at
BEFORE UPDATE ON tenant_domain
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS tenant_admin_membership_set_updated_at ON tenant_admin_membership;
CREATE TRIGGER tenant_admin_membership_set_updated_at
BEFORE UPDATE ON tenant_admin_membership
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS tenant_feature_flag_set_updated_at ON tenant_feature_flag;
CREATE TRIGGER tenant_feature_flag_set_updated_at
BEFORE UPDATE ON tenant_feature_flag
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Replace every pre-tenant global uniqueness rule with tenant-scoped rules.
ALTER TABLE campaign DROP CONSTRAINT IF EXISTS campaign_slug_key;
ALTER TABLE campaign DROP CONSTRAINT IF EXISTS campaign_slug_unique;
ALTER TABLE campaign_placement DROP CONSTRAINT IF EXISTS campaign_placement_placement_key_key;
ALTER TABLE campaign_placement DROP CONSTRAINT IF EXISTS campaign_placement_key_unique;
ALTER TABLE listener_device DROP CONSTRAINT IF EXISTS listener_device_token_hash_key;
ALTER TABLE listener_device DROP CONSTRAINT IF EXISTS listener_device_token_hash_unique;
ALTER TABLE sweepstake_draw DROP CONSTRAINT IF EXISTS sweepstake_draw_request_token_key;
ALTER TABLE sweepstake_draw DROP CONSTRAINT IF EXISTS sweepstake_draw_request_token_unique;
ALTER TABLE sweepstake_draw_entry DROP CONSTRAINT IF EXISTS sweepstake_draw_entry_draw_ordinal_key;
ALTER TABLE sweepstake_draw_entry DROP CONSTRAINT IF EXISTS sweepstake_draw_entry_draw_ordinal_unique;

DROP INDEX IF EXISTS listener_registration_campaign_submission_unique;
DROP INDEX IF EXISTS listener_registration_campaign_phone_unique;
DROP INDEX IF EXISTS campaign_participation_campaign_profile_unique;
DROP INDEX IF EXISTS sweepstake_draw_campaign_sequence_unique;
DROP INDEX IF EXISTS sweepstake_draw_campaign_selected_unique;
DROP INDEX IF EXISTS sweepstake_draw_request_token_unique;

CREATE UNIQUE INDEX IF NOT EXISTS listener_registration_tenant_submission_unique
  ON listener_registration (tenant_id, campaign_id, submission_token);
CREATE UNIQUE INDEX IF NOT EXISTS listener_registration_tenant_phone_unique
  ON listener_registration (tenant_id, campaign_id, phone_normalized)
  WHERE phone_normalized IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS campaign_participation_tenant_profile_unique
  ON campaign_participation (tenant_id, campaign_id, listener_profile_id);
CREATE UNIQUE INDEX IF NOT EXISTS sweepstake_draw_tenant_campaign_sequence_unique
  ON sweepstake_draw (tenant_id, campaign_id, sequence);
CREATE UNIQUE INDEX IF NOT EXISTS sweepstake_draw_tenant_campaign_selected_unique
  ON sweepstake_draw (tenant_id, campaign_id)
  WHERE status = 'selected';
CREATE UNIQUE INDEX IF NOT EXISTS sweepstake_draw_tenant_request_token_unique
  ON sweepstake_draw (tenant_id, request_token);

ALTER TABLE sweepstake_draw_entry DROP CONSTRAINT IF EXISTS sweepstake_draw_entry_pkey;
ALTER TABLE sweepstake_draw_entry
  ADD CONSTRAINT sweepstake_draw_entry_pkey
  PRIMARY KEY (tenant_id, draw_id, participation_id);
CREATE UNIQUE INDEX IF NOT EXISTS sweepstake_draw_entry_tenant_ordinal_unique
  ON sweepstake_draw_entry (tenant_id, draw_id, ordinal);

-- Initial host mappings are additive. Unknown hosts still use radio-88 until a tenant is onboarded.
INSERT INTO tenant_domain (tenant_id, hostname, is_primary, active)
SELECT t.id, domains.hostname, domains.is_primary, true
FROM tenant t
CROSS JOIN (
  VALUES
    ('radio88fm.com', true),
    ('www.radio88fm.com', false),
    ('localhost', false),
    ('127.0.0.1', false)
) AS domains(hostname, is_primary)
WHERE t.slug = 'radio-88'
ON CONFLICT (lower(hostname)) DO NOTHING;
