-- Additive administrative domain; no public voting or publication effects.
CREATE TABLE radio_program_edition (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), radio_key varchar(80) NOT NULL, program_id uuid NOT NULL,
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, CHECK(ends_at>starts_at),
 UNIQUE(radio_key,program_id,id), UNIQUE(radio_key,program_id,starts_at,ends_at),
 FOREIGN KEY(radio_key,program_id) REFERENCES radio_program(radio_key,id) ON DELETE RESTRICT
);
CREATE TABLE radio_poll (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), radio_key varchar(80) NOT NULL, program_id uuid NOT NULL, edition_id uuid NOT NULL,
 slug varchar(120) NOT NULL CHECK(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 question varchar(500) NOT NULL CHECK(length(trim(question))>=3), context varchar(2000) NOT NULL DEFAULT '',
 identification_policy varchar(20) NOT NULL CHECK(identification_policy IN('anonymous','optional','required')),
 allow_message boolean NOT NULL DEFAULT false, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 state varchar(20) NOT NULL DEFAULT 'draft' CHECK(state IN('draft','scheduled','published','closed','archived','canceled')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), CHECK(ends_at>starts_at),
 UNIQUE(radio_key,program_id,id), UNIQUE(radio_key,program_id,slug),
 FOREIGN KEY(radio_key,program_id,edition_id) REFERENCES radio_program_edition(radio_key,program_id,id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX radio_poll_one_active_main ON radio_poll(radio_key,program_id,edition_id) WHERE state IN('scheduled','published');
CREATE INDEX radio_poll_list ON radio_poll(radio_key,id);
CREATE TABLE radio_poll_option (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), radio_key varchar(80) NOT NULL, program_id uuid NOT NULL, poll_id uuid NOT NULL,
 text varchar(300) NOT NULL CHECK(length(trim(text))>0), position smallint NOT NULL CHECK(position BETWEEN 0 AND 9),
 active boolean NOT NULL DEFAULT true,
 UNIQUE(radio_key,program_id,poll_id,id),
 FOREIGN KEY(radio_key,program_id,poll_id) REFERENCES radio_poll(radio_key,program_id,id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX radio_poll_option_position ON radio_poll_option(poll_id,position) WHERE active;
INSERT INTO permission(key,description) VALUES
 ('poll.read','Consultar enquetes autorizadas'),('poll.manage','Criar e editar enquetes'),
 ('poll.publish','Publicar estado administrativo local'),('poll.close','Encerrar arquivar ou cancelar enquete'),
 ('poll.results.read','Consultar agregados privados') ON CONFLICT DO NOTHING;
INSERT INTO role_permission(role_id,permission_id)
 SELECT r.id,p.id FROM role r CROSS JOIN permission p WHERE p.key IN('poll.read','poll.manage','poll.publish','poll.close','poll.results.read')
 AND (r.key='admin' OR (r.key='announcer' AND p.key IN('poll.read','poll.results.read'))) ON CONFLICT DO NOTHING;
INSERT INTO role_permission_scope(role_id,permission_id,scope_type)
 SELECT rp.role_id,rp.permission_id,CASE WHEN r.key='admin' THEN 'global' ELSE 'participation' END
 FROM role_permission rp JOIN role r ON r.id=rp.role_id JOIN permission p ON p.id=rp.permission_id
 WHERE p.key IN('poll.read','poll.manage','poll.publish','poll.close','poll.results.read')
 AND (r.key='admin' OR (r.key='announcer' AND p.key IN('poll.read','poll.results.read'))) ON CONFLICT DO NOTHING;
-- Storage authority prepared only. No public write path or identity/consent policy is enabled.
CREATE TABLE radio_poll_vote (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), radio_key varchar(80) NOT NULL, program_id uuid NOT NULL,
 poll_id uuid NOT NULL, option_id uuid NOT NULL, voter_key uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(radio_key,program_id,poll_id,voter_key),
 FOREIGN KEY(radio_key,program_id,poll_id,option_id) REFERENCES radio_poll_option(radio_key,program_id,poll_id,id) ON DELETE RESTRICT
);
CREATE INDEX radio_poll_vote_aggregate ON radio_poll_vote(radio_key,program_id,poll_id,option_id);
