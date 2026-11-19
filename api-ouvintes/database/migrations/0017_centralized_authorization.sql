ALTER TABLE admin_user
  ADD COLUMN IF NOT EXISTS authz_version integer NOT NULL DEFAULT 1;

ALTER TABLE admin_user
  ADD CONSTRAINT admin_user_authz_version_positive_check
  CHECK (authz_version > 0);

CREATE TABLE IF NOT EXISTS admin_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL REFERENCES admin_user(id) ON DELETE CASCADE,
  authz_version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoke_reason varchar(80),
  CONSTRAINT admin_session_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT admin_session_revocation_check CHECK (
    (revoked_at IS NULL AND revoke_reason IS NULL)
    OR (revoked_at IS NOT NULL AND revoke_reason IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS admin_session_user_active_idx
  ON admin_session (admin_user_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS admin_session_expiry_idx
  ON admin_session (expires_at);

CREATE TABLE IF NOT EXISTS admin_department (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key varchar(80) NOT NULL UNIQUE,
  name varchar(120) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_department_key_check CHECK (key ~ '^[a-z0-9_-]+$')
);

CREATE TABLE IF NOT EXISTS admin_user_department (
  admin_user_id uuid NOT NULL REFERENCES admin_user(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES admin_department(id) ON DELETE RESTRICT,
  is_manager boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (admin_user_id, department_id)
);

CREATE TABLE IF NOT EXISTS role_permission_scope (
  role_id uuid NOT NULL,
  permission_id uuid NOT NULL,
  scope_type varchar(24) NOT NULL,
  department_id uuid REFERENCES admin_department(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_id, scope_type),
  FOREIGN KEY (role_id, permission_id)
    REFERENCES role_permission(role_id, permission_id) ON DELETE CASCADE,
  CONSTRAINT role_permission_scope_type_check
    CHECK (scope_type IN ('global', 'own', 'participation', 'department')),
  CONSTRAINT role_permission_scope_department_check
    CHECK ((scope_type = 'department') OR department_id IS NULL)
);

CREATE TABLE IF NOT EXISTS admin_permission_override (
  admin_user_id uuid NOT NULL REFERENCES admin_user(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permission(id) ON DELETE CASCADE,
  effect varchar(8) NOT NULL,
  scope_type varchar(24),
  department_id uuid REFERENCES admin_department(id) ON DELETE RESTRICT,
  reason varchar(500) NOT NULL,
  created_by_admin_user_id uuid NOT NULL REFERENCES admin_user(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (admin_user_id, permission_id),
  CONSTRAINT admin_permission_override_effect_check CHECK (effect IN ('ALLOW', 'DENY')),
  CONSTRAINT admin_permission_override_scope_check CHECK (
    (effect = 'DENY' AND scope_type IS NULL AND department_id IS NULL)
    OR (
      effect = 'ALLOW'
      AND scope_type IS NOT NULL
      AND scope_type IN ('global', 'own', 'participation', 'department')
    )
  ),
  CONSTRAINT admin_permission_override_department_check CHECK (
    scope_type = 'department' OR department_id IS NULL
  ),
  CONSTRAINT admin_permission_override_reason_check CHECK (char_length(btrim(reason)) >= 5)
);

INSERT INTO permission (key, description)
VALUES
  ('public_config.manage', 'Republicar configuracao publica institucional'),
  ('campaign.admin.manage', 'Gerenciar campanhas com privilégio administrativo legado')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r CROSS JOIN permission p
WHERE r.key = 'admin' AND p.key IN ('public_config.manage', 'campaign.admin.manage')
ON CONFLICT DO NOTHING;

INSERT INTO role (key, name, description)
VALUES ('viewer', 'Visualizador', 'Acesso de consulta legado, sem privilegios administrativos')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r CROSS JOIN permission p
WHERE r.key = 'viewer' AND p.key IN ('campaign.read', 'listener.read')
ON CONFLICT DO NOTHING;

-- Preserve the pre-centralization read surface without granting phone or export access.
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r CROSS JOIN permission p
WHERE r.key IN ('admin', 'campaign_manager', 'receptionist', 'announcer', 'auditor', 'viewer')
  AND p.key IN ('campaign.read', 'listener.read')
ON CONFLICT DO NOTHING;

INSERT INTO admin_user_role (admin_user_id, role_id)
SELECT au.id, r.id
FROM admin_user au
JOIN role r ON r.key = au.role
ON CONFLICT DO NOTHING;

-- Existing role grants retain their current effective scope. Future grants must add
-- an explicit scope row; authorization fails closed when the scope is absent.
INSERT INTO role_permission_scope (role_id, permission_id, scope_type)
SELECT rp.role_id, rp.permission_id, 'global'
FROM role_permission rp
ON CONFLICT DO NOTHING;

CREATE TRIGGER admin_department_set_updated_at
BEFORE UPDATE ON admin_department
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
