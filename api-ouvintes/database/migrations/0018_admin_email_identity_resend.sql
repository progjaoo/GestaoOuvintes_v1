ALTER TABLE admin_user
  ADD COLUMN IF NOT EXISTS email varchar(320),
  ADD COLUMN IF NOT EXISTS email_normalized varchar(320),
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS phone varchar(20),
  ADD COLUMN IF NOT EXISTS phone_normalized varchar(20),
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_super_admin boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;

ALTER TABLE admin_user
  ADD CONSTRAINT admin_user_version_positive_check CHECK (version > 0),
  ADD CONSTRAINT admin_user_email_normalized_check CHECK (
    (email IS NULL AND email_normalized IS NULL)
    OR (email IS NOT NULL AND email_normalized = lower(btrim(email)))
  ),
  ADD CONSTRAINT admin_user_phone_normalized_e164_check CHECK (
    phone_normalized IS NULL OR phone_normalized ~ '^[+][1-9][0-9]{7,14}$'
  );

CREATE UNIQUE INDEX IF NOT EXISTS admin_user_email_normalized_unique
  ON admin_user (email_normalized)
  WHERE email_normalized IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS admin_user_single_super_admin_unique
  ON admin_user (is_super_admin)
  WHERE is_super_admin = true;

ALTER TABLE admin_session
  ADD COLUMN IF NOT EXISTS reauthenticated_at timestamptz;

ALTER TABLE role
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

ALTER TABLE role
  ADD CONSTRAINT role_version_positive_check CHECK (version > 0);

UPDATE admin_session
SET reauthenticated_at = created_at
WHERE reauthenticated_at IS NULL;

CREATE TABLE IF NOT EXISTS admin_identity_token (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL REFERENCES admin_user(id) ON DELETE CASCADE,
  kind varchar(24) NOT NULL,
  email_normalized_snapshot varchar(320) NOT NULL,
  token_hash varchar(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  delivery_status varchar(16) NOT NULL DEFAULT 'pending',
  created_by_admin_user_id uuid REFERENCES admin_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_identity_token_kind_check
    CHECK (kind IN ('invite', 'password_reset', 'email_verification')),
  CONSTRAINT admin_identity_token_delivery_check
    CHECK (delivery_status IN ('pending', 'sent', 'failed', 'uncertain')),
  CONSTRAINT admin_identity_token_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT admin_identity_token_consumption_check CHECK (
    used_at IS NULL OR revoked_at IS NULL
  )
);

CREATE INDEX IF NOT EXISTS admin_identity_token_user_kind_idx
  ON admin_identity_token (admin_user_id, kind, created_at DESC);

CREATE INDEX IF NOT EXISTS admin_identity_token_expiry_idx
  ON admin_identity_token (expires_at)
  WHERE used_at IS NULL AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS admin_identity_rate_limit (
  key_hash varchar(64) PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  attempt_count integer NOT NULL,
  CONSTRAINT admin_identity_rate_limit_count_check CHECK (attempt_count > 0)
);

INSERT INTO permission (key, description)
VALUES
  ('user.read', 'Consultar usuarios administrativos'),
  ('user.create', 'Criar usuarios administrativos'),
  ('user.update', 'Atualizar usuarios administrativos'),
  ('user.deactivate', 'Ativar ou desativar usuarios administrativos'),
  ('user.password.reset', 'Solicitar redefinicao de senha'),
  ('user.session.revoke', 'Revogar sessoes administrativas'),
  ('user.permissions.read', 'Consultar acesso efetivo de usuarios'),
  ('user.permissions.manage', 'Gerenciar excecoes individuais de acesso'),
  ('role.read', 'Consultar papeis administrativos'),
  ('role.create', 'Criar papeis administrativos'),
  ('role.update', 'Atualizar papeis administrativos'),
  ('permission.read', 'Consultar catalogo de permissoes')
ON CONFLICT (key) DO NOTHING;

-- Preserve existing administrator capability. Services still enforce delegation
-- ceilings and reserve protected identity privileges for the Super Admin.
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r
CROSS JOIN permission p
WHERE r.key = 'admin'
  AND p.key IN (
    'user.read', 'user.create', 'user.update', 'user.deactivate',
    'user.password.reset', 'user.session.revoke', 'user.permissions.read',
    'user.permissions.manage', 'role.read', 'role.create', 'role.update',
    'permission.read'
  )
ON CONFLICT DO NOTHING;

INSERT INTO role_permission_scope (role_id, permission_id, scope_type)
SELECT rp.role_id, rp.permission_id, 'global'
FROM role_permission rp
JOIN role r ON r.id = rp.role_id AND r.key = 'admin'
JOIN permission p ON p.id = rp.permission_id
WHERE p.key IN (
  'user.read', 'user.create', 'user.update', 'user.deactivate',
  'user.password.reset', 'user.session.revoke', 'user.permissions.read',
  'user.permissions.manage', 'role.read', 'role.create', 'role.update',
  'permission.read'
)
ON CONFLICT DO NOTHING;
