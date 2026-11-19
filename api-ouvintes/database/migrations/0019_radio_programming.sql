CREATE TABLE radio_programming_scope (
  key varchar(80) PRIMARY KEY,
  timezone varchar(80) NOT NULL DEFAULT 'America/Sao_Paulo'
    CHECK (timezone = 'America/Sao_Paulo')
);
INSERT INTO radio_programming_scope (key) VALUES ('radio-88');
CREATE TABLE radio_program (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  radio_key varchar(80) NOT NULL REFERENCES radio_programming_scope(key),
  name varchar(160) NOT NULL CHECK (length(trim(name)) >= 2),
  slug varchar(120) NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description varchar(1000) NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (radio_key, id), UNIQUE (radio_key, slug)
);
CREATE TABLE radio_program_slot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), radio_key varchar(80) NOT NULL,
  program_id uuid NOT NULL, weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_minute smallint NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute smallint NOT NULL CHECK (end_minute BETWEEN 0 AND 1439),
  valid_from date NOT NULL, valid_until date, active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (start_minute <> end_minute), CHECK (valid_until IS NULL OR valid_until >= valid_from),
  FOREIGN KEY (radio_key, program_id) REFERENCES radio_program(radio_key, id)
);
CREATE INDEX radio_program_slot_scope_idx ON radio_program_slot(radio_key, weekday, valid_from) WHERE active;
CREATE TABLE radio_program_host (
  radio_key varchar(80) NOT NULL, program_id uuid NOT NULL,
  admin_user_id uuid NOT NULL REFERENCES admin_user(id) ON DELETE RESTRICT,
  active boolean NOT NULL DEFAULT true, valid_from timestamptz NOT NULL, valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (radio_key, program_id, admin_user_id),
  CHECK (valid_until IS NULL OR valid_until > valid_from),
  FOREIGN KEY (radio_key, program_id) REFERENCES radio_program(radio_key, id)
);
CREATE INDEX radio_program_host_user_idx ON radio_program_host(admin_user_id, radio_key, program_id) WHERE active;
INSERT INTO permission(key, description) VALUES
 ('program.read', 'Consultar programas autorizados'),
 ('program.manage', 'Criar e editar programas'),
 ('schedule.manage', 'Gerenciar grade semanal'),
 ('program.host.manage', 'Gerenciar vinculos de locutores')
ON CONFLICT (key) DO NOTHING;
INSERT INTO role_permission(role_id,permission_id)
 SELECT r.id,p.id FROM role r CROSS JOIN permission p
 WHERE r.key='admin' AND p.key IN ('program.read','program.manage','schedule.manage','program.host.manage')
ON CONFLICT DO NOTHING;
INSERT INTO role_permission_scope(role_id,permission_id,scope_type)
 SELECT rp.role_id,rp.permission_id,'global' FROM role_permission rp
 JOIN role r ON r.id=rp.role_id JOIN permission p ON p.id=rp.permission_id
 WHERE r.key='admin' AND p.key IN ('program.read','program.manage','schedule.manage','program.host.manage')
ON CONFLICT DO NOTHING;
INSERT INTO role_permission(role_id,permission_id)
 SELECT r.id,p.id FROM role r CROSS JOIN permission p WHERE r.key='announcer' AND p.key='program.read'
ON CONFLICT DO NOTHING;
INSERT INTO role_permission_scope(role_id,permission_id,scope_type)
 SELECT rp.role_id,rp.permission_id,'participation' FROM role_permission rp
 JOIN role r ON r.id=rp.role_id JOIN permission p ON p.id=rp.permission_id
 WHERE r.key='announcer' AND p.key='program.read'
ON CONFLICT DO NOTHING;
