-- Additive private moderation only. No public intake, contacts or publication.
ALTER TABLE radio_poll ADD CONSTRAINT radio_poll_edition_identity_unique
  UNIQUE (radio_key, program_id, edition_id, id);

CREATE TABLE radio_program_participation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  radio_key varchar(80) NOT NULL,
  program_id uuid NOT NULL,
  edition_id uuid NOT NULL,
  poll_id uuid NOT NULL,
  display_name varchar(160),
  message varchar(4000) NOT NULL CHECK (length(btrim(message)) > 0),
  state varchar(20) NOT NULL DEFAULT 'received'
    CHECK (state IN ('received', 'reviewed', 'selected', 'rejected')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  moderated_at timestamptz,
  moderation_note varchar(500),
  CHECK (display_name IS NULL OR length(btrim(display_name)) > 0),
  CHECK ((state = 'received' AND moderated_at IS NULL AND moderation_note IS NULL)
    OR (state <> 'received' AND moderated_at IS NOT NULL)),
  FOREIGN KEY (radio_key, program_id) REFERENCES radio_program(radio_key, id) ON DELETE RESTRICT,
  FOREIGN KEY (radio_key, program_id, edition_id)
    REFERENCES radio_program_edition(radio_key, program_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (radio_key, program_id, edition_id, poll_id)
    REFERENCES radio_poll(radio_key, program_id, edition_id, id) ON DELETE RESTRICT
);
CREATE INDEX radio_participation_list ON radio_program_participation(radio_key, id);
CREATE INDEX radio_participation_program_list ON radio_program_participation(radio_key, program_id, id);
CREATE INDEX radio_participation_poll_list ON radio_program_participation(radio_key, poll_id, id);
CREATE INDEX radio_participation_state_list ON radio_program_participation(radio_key, state, id);

CREATE FUNCTION protect_radio_participation_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id, NEW.radio_key, NEW.program_id, NEW.edition_id, NEW.poll_id,
      NEW.display_name, NEW.message, NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id, OLD.radio_key, OLD.program_id, OLD.edition_id, OLD.poll_id,
      OLD.display_name, OLD.message, OLD.created_at) THEN
    RAISE EXCEPTION 'Participation content and origin are immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.state = 'received' OR NEW.version <> OLD.version + 1 OR NEW.moderated_at IS NULL THEN
    RAISE EXCEPTION 'Participation updates require versioned moderation' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER radio_participation_immutable_content BEFORE UPDATE ON radio_program_participation
  FOR EACH ROW EXECUTE FUNCTION protect_radio_participation_content();

INSERT INTO permission(key, description) VALUES
  ('participation.read', 'Consultar opinioes privadas autorizadas'),
  ('participation.moderate', 'Moderar opinioes privadas autorizadas') ON CONFLICT DO NOTHING;
INSERT INTO role_permission(role_id, permission_id)
  SELECT r.id,p.id FROM role r CROSS JOIN permission p
  WHERE (r.key='admin' AND p.key IN ('participation.read','participation.moderate'))
    OR (r.key='announcer' AND p.key='participation.read') ON CONFLICT DO NOTHING;
INSERT INTO role_permission_scope(role_id, permission_id, scope_type)
  SELECT rp.role_id,rp.permission_id,CASE WHEN r.key='admin' THEN 'global' ELSE 'participation' END
  FROM role_permission rp JOIN role r ON r.id=rp.role_id JOIN permission p ON p.id=rp.permission_id
  WHERE (r.key='admin' AND p.key IN ('participation.read','participation.moderate'))
    OR (r.key='announcer' AND p.key='participation.read') ON CONFLICT DO NOTHING;
