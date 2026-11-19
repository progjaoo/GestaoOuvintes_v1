-- Plan 009, additive private staging only. No tokens, auto-publication or implicit role grants.
CREATE TABLE radio_calendar_source (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), radio_key varchar(80) NOT NULL,
 calendar_id varchar(1024) NOT NULL CHECK(length(btrim(calendar_id))>0), program_id uuid NOT NULL,
 active boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1 CHECK(version>0),
 lease_token uuid, lease_until timestamptz, sync_token text,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(radio_key,id), UNIQUE(radio_key,calendar_id),
 FOREIGN KEY(radio_key,program_id) REFERENCES radio_program(radio_key,id) ON DELETE RESTRICT,
 CHECK((lease_token IS NULL)=(lease_until IS NULL))
);
CREATE TABLE radio_calendar_event_stage (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), radio_key varchar(80) NOT NULL, source_id uuid NOT NULL,
 event_id varchar(1024) NOT NULL CHECK(length(btrim(event_id))>0),
 state varchar(24) NOT NULL CHECK(state IN('review','conflict','canceled','invalid')),
 content_hash varchar(64) NOT NULL, payload jsonb, reason varchar(80),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(radio_key,source_id,event_id),
 FOREIGN KEY(radio_key,source_id) REFERENCES radio_calendar_source(radio_key,id) ON DELETE RESTRICT
);
CREATE INDEX radio_calendar_stage_review ON radio_calendar_event_stage(radio_key,source_id,state,id);
CREATE TABLE radio_calendar_sync_run (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), radio_key varchar(80) NOT NULL, source_id uuid NOT NULL,
 lease_token uuid NOT NULL UNIQUE, actor_id uuid NOT NULL REFERENCES admin_user(id) ON DELETE RESTRICT,
 state varchar(24) NOT NULL DEFAULT 'running' CHECK(state IN('running','completed','superseded')),
 started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 FOREIGN KEY(radio_key,source_id) REFERENCES radio_calendar_source(radio_key,id) ON DELETE RESTRICT
);
INSERT INTO permission(key,description) VALUES
 ('calendar_integration.manage','Configurar fontes privadas do Google Agenda'),
 ('calendar_integration.sync','Sincronizar eventos para conferencia privada'),
 ('calendar_integration.read','Consultar importacoes privadas do Google Agenda')
ON CONFLICT DO NOTHING;
-- Grants must be assigned explicitly through the access management policy.
