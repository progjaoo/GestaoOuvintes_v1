ALTER TABLE campaign
  ADD COLUMN IF NOT EXISTS type varchar(30) NOT NULL DEFAULT 'registration',
  ADD COLUMN IF NOT EXISTS public_version bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS created_by_admin_user_id uuid REFERENCES admin_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by_admin_user_id uuid REFERENCES admin_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE campaign
  DROP CONSTRAINT IF EXISTS campaign_type_check;

ALTER TABLE campaign
  ADD CONSTRAINT campaign_type_check
  CHECK (type IN ('registration', 'sweepstake', 'engagement'));

ALTER TABLE admin_user
  DROP CONSTRAINT IF EXISTS admin_user_role_check;

CREATE TABLE IF NOT EXISTS campaign_placement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  placement_key varchar(80) NOT NULL UNIQUE,
  campaign_id uuid REFERENCES campaign(id) ON DELETE SET NULL,
  version bigint NOT NULL DEFAULT 1,
  published_at timestamptz,
  published_by_admin_user_id uuid REFERENCES admin_user(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_placement_key_check
    CHECK (placement_key ~ '^[a-z0-9_:-]+$')
);

CREATE INDEX IF NOT EXISTS campaign_placement_campaign_idx
  ON campaign_placement (campaign_id);

CREATE TABLE IF NOT EXISTS listener_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(160) NOT NULL,
  neighborhood varchar(120) NOT NULL,
  city varchar(120) NOT NULL,
  phone varchar(20),
  phone_normalized varchar(20),
  status varchar(20) NOT NULL DEFAULT 'active',
  marketing_opt_in boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT listener_profile_status_check
    CHECK (status IN ('active', 'blocked', 'deleted')),
  CONSTRAINT listener_profile_name_check CHECK (char_length(btrim(name)) >= 2),
  CONSTRAINT listener_profile_neighborhood_check CHECK (char_length(btrim(neighborhood)) >= 2),
  CONSTRAINT listener_profile_city_check CHECK (char_length(btrim(city)) >= 2)
);

CREATE INDEX IF NOT EXISTS listener_profile_phone_normalized_idx
  ON listener_profile (phone_normalized)
  WHERE phone_normalized IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS listener_profile_city_idx
  ON listener_profile (lower(city))
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS listener_device (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listener_profile_id uuid REFERENCES listener_profile(id) ON DELETE SET NULL,
  token_hash varchar(128) NOT NULL UNIQUE,
  platform varchar(30) NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  linked_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT listener_device_platform_check
    CHECK (platform IN ('web_mobile', 'web_desktop', 'web_tablet', 'expo_ios', 'expo_android'))
);

CREATE INDEX IF NOT EXISTS listener_device_profile_idx
  ON listener_device (listener_profile_id)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS campaign_participation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaign(id) ON DELETE RESTRICT,
  listener_profile_id uuid NOT NULL REFERENCES listener_profile(id) ON DELETE RESTRICT,
  listener_device_id uuid REFERENCES listener_device(id) ON DELETE SET NULL,
  source varchar(50) NOT NULL DEFAULT 'web',
  status varchar(20) NOT NULL DEFAULT 'eligible',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_participation_status_check
    CHECK (status IN ('eligible', 'entered', 'withdrawn', 'disqualified')),
  CONSTRAINT campaign_participation_source_check
    CHECK (source IN ('web', 'expo', 'receptionist', 'import'))
);

CREATE UNIQUE INDEX IF NOT EXISTS campaign_participation_campaign_profile_unique
  ON campaign_participation (campaign_id, listener_profile_id);

CREATE INDEX IF NOT EXISTS campaign_participation_campaign_created_idx
  ON campaign_participation (campaign_id, created_at DESC);

CREATE TABLE IF NOT EXISTS campaign_device_state (
  campaign_id uuid NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  listener_device_id uuid NOT NULL REFERENCES listener_device(id) ON DELETE CASCADE,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  dismissed_until timestamptz,
  modal_open_count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (campaign_id, listener_device_id),
  CONSTRAINT campaign_device_state_modal_open_count_check CHECK (modal_open_count >= 0)
);

CREATE TABLE IF NOT EXISTS role (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key varchar(80) NOT NULL UNIQUE,
  name varchar(120) NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS permission (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key varchar(120) NOT NULL UNIQUE,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_user_role (
  admin_user_id uuid NOT NULL REFERENCES admin_user(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (admin_user_id, role_id)
);

CREATE TABLE IF NOT EXISTS role_permission (
  role_id uuid NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permission(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid REFERENCES admin_user(id) ON DELETE SET NULL,
  action varchar(120) NOT NULL,
  resource_type varchar(80) NOT NULL,
  resource_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_log_created_idx
  ON admin_audit_log (created_at DESC);

CREATE TRIGGER campaign_placement_set_updated_at
BEFORE UPDATE ON campaign_placement
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER listener_profile_set_updated_at
BEFORE UPDATE ON listener_profile
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER campaign_participation_set_updated_at
BEFORE UPDATE ON campaign_participation
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER role_set_updated_at
BEFORE UPDATE ON role
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

INSERT INTO permission (key, description)
VALUES
  ('campaign.read', 'Consultar campanhas'),
  ('campaign.create', 'Criar campanhas'),
  ('campaign.update', 'Atualizar campanhas'),
  ('campaign.publish', 'Publicar campanhas em placements'),
  ('listener.read', 'Consultar ouvintes'),
  ('listener.create', 'Cadastrar ouvintes'),
  ('listener.update', 'Atualizar ouvintes'),
  ('listener.contact', 'Registrar contato com ouvintes'),
  ('listener.phone.read', 'Visualizar telefone completo'),
  ('participation.create', 'Criar participacao em campanhas'),
  ('registration.export', 'Exportar cadastros'),
  ('user.manage', 'Gerenciar usuarios e funcoes'),
  ('role.manage', 'Gerenciar funcoes e permissoes'),
  ('audit.read', 'Consultar auditoria')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role (key, name, description)
VALUES
  ('admin', 'Administrador', 'Acesso total ao sistema'),
  ('campaign_manager', 'Gestor de campanhas', 'Gerencia campanhas e publicacoes'),
  ('receptionist', 'Recepcionista', 'Cadastra ouvintes e registra contatos'),
  ('announcer', 'Locutor', 'Consulta campanhas e informacoes publicas permitidas'),
  ('auditor', 'Auditor', 'Consulta auditoria e relatorios permitidos')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r
CROSS JOIN permission p
WHERE r.key = 'admin'
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r
JOIN permission p ON p.key IN (
  'campaign.read',
  'campaign.create',
  'campaign.update',
  'campaign.publish',
  'listener.read',
  'participation.create'
)
WHERE r.key = 'campaign_manager'
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r
JOIN permission p ON p.key IN (
  'listener.read',
  'listener.create',
  'listener.update',
  'listener.contact',
  'listener.phone.read',
  'participation.create'
)
WHERE r.key = 'receptionist'
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r
JOIN permission p ON p.key IN ('campaign.read', 'listener.read')
WHERE r.key = 'announcer'
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r
JOIN permission p ON p.key IN ('campaign.read', 'audit.read')
WHERE r.key = 'auditor'
ON CONFLICT DO NOTHING;

INSERT INTO admin_user_role (admin_user_id, role_id)
SELECT au.id, r.id
FROM admin_user au
JOIN role r ON r.key = au.role
ON CONFLICT DO NOTHING;

INSERT INTO campaign_placement (placement_key, campaign_id, version, published_at)
SELECT 'institutional_modal', c.id, 1, now()
FROM campaign c
WHERE c.status = 'active'
  AND c.starts_at <= now()
  AND (c.ends_at IS NULL OR c.ends_at > now())
ORDER BY c.created_at DESC
LIMIT 1
ON CONFLICT (placement_key) DO NOTHING;
