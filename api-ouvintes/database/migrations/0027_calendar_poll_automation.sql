-- Local/long-running automation is represented as an internal session, never as a JWT session.
ALTER TABLE admin_session
  ADD COLUMN session_type varchar(20) NOT NULL DEFAULT 'interactive'
  CHECK (session_type IN ('interactive', 'automation'));

ALTER TABLE radio_calendar_source
  ADD COLUMN parser_revision integer NOT NULL DEFAULT 0
  CHECK (parser_revision >= 0);

CREATE INDEX admin_session_automation_active
  ON admin_session(admin_user_id, expires_at)
  WHERE session_type = 'automation' AND revoked_at IS NULL;

CREATE TABLE radio_calendar_poll_link (
  radio_key varchar(80) NOT NULL,
  source_id uuid NOT NULL,
  event_id varchar(1024) NOT NULL,
  program_id uuid NOT NULL,
  poll_id uuid NOT NULL,
  content_hash varchar(64) NOT NULL,
  external_state varchar(20) NOT NULL DEFAULT 'active'
    CHECK (external_state IN ('active', 'canceled', 'review')),
  linked_by uuid NOT NULL REFERENCES admin_user(id) ON DELETE RESTRICT,
  linked_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (radio_key, source_id, event_id),
  UNIQUE (radio_key, program_id, poll_id),
  FOREIGN KEY (radio_key, source_id, event_id)
    REFERENCES radio_calendar_event_stage(radio_key, source_id, event_id) ON DELETE RESTRICT,
  FOREIGN KEY (radio_key, program_id, poll_id)
    REFERENCES radio_poll(radio_key, program_id, id) ON DELETE RESTRICT
);

CREATE INDEX radio_calendar_poll_link_poll
  ON radio_calendar_poll_link(radio_key, poll_id);
