ALTER TABLE radio_program ADD COLUMN presenters jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(presenters)='array');
ALTER TABLE radio_program ADD COLUMN image_asset_id uuid REFERENCES media_asset(id) ON DELETE RESTRICT;
CREATE TABLE radio_program_override (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), radio_key varchar(80) NOT NULL REFERENCES radio_programming_scope(key),
 program_id uuid, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 reason varchar(500) NOT NULL CHECK(length(trim(reason))>=5),active boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(ends_at>starts_at),FOREIGN KEY(radio_key,program_id) REFERENCES radio_program(radio_key,id)
);
CREATE INDEX radio_program_override_time_idx ON radio_program_override(radio_key,starts_at,ends_at) WHERE active;
CREATE TABLE radio_programming_publication (
 revision bigserial PRIMARY KEY, radio_key varchar(80) NOT NULL REFERENCES radio_programming_scope(key),
 payload jsonb NOT NULL, status varchar(20) NOT NULL DEFAULT 'pending' CHECK(status IN('pending','published','failed','superseded')),
 attempts integer NOT NULL DEFAULT 0, last_error varchar(100), created_at timestamptz NOT NULL DEFAULT now(),published_at timestamptz
);
CREATE INDEX radio_programming_publication_pending_idx ON radio_programming_publication(radio_key,revision DESC);
INSERT INTO permission(key,description) VALUES('programming.publish','Publicar configuracao publica de programas e grade') ON CONFLICT DO NOTHING;
INSERT INTO role_permission(role_id,permission_id) SELECT r.id,p.id FROM role r CROSS JOIN permission p WHERE r.key='admin' AND p.key='programming.publish' ON CONFLICT DO NOTHING;
INSERT INTO role_permission_scope(role_id,permission_id,scope_type) SELECT rp.role_id,rp.permission_id,'global' FROM role_permission rp JOIN role r ON r.id=rp.role_id JOIN permission p ON p.id=rp.permission_id WHERE r.key='admin' AND p.key='programming.publish' ON CONFLICT DO NOTHING;
