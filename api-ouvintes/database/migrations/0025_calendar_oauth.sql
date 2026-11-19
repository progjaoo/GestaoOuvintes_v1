-- OAuth connection for a private, read-only Google Calendar integration.
CREATE TABLE radio_calendar_oauth_state (
  state_hash varchar(64) PRIMARY KEY,
  radio_key varchar(80) NOT NULL,
  admin_user_id uuid NOT NULL REFERENCES admin_user(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL REFERENCES admin_session(id) ON DELETE RESTRICT,
  authz_version integer NOT NULL CHECK(authz_version>0),
  pkce_verifier_ciphertext text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX radio_calendar_oauth_state_expiry ON radio_calendar_oauth_state(expires_at);
CREATE TABLE radio_calendar_oauth_connection (
  radio_key varchar(80) PRIMARY KEY,
  refresh_token_ciphertext text NOT NULL,
  granted_scopes text[] NOT NULL,
  connected_by uuid NOT NULL REFERENCES admin_user(id) ON DELETE RESTRICT,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(granted_scopes = ARRAY['https://www.googleapis.com/auth/calendar.events.readonly']::text[])
);
