-- Clerk webhook lifecycle and idempotency state.
-- The event table is intentionally global: one Clerk event can match
-- previously linked identities in more than one tenant.

CREATE TABLE IF NOT EXISTS clerk_webhook_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_key varchar(120) NOT NULL,
  event_id varchar(255) NOT NULL,
  event_type varchar(80) NOT NULL,
  clerk_user_id varchar(255),
  payload_hash varchar(64) NOT NULL,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  status varchar(20) NOT NULL DEFAULT 'received',
  attempts integer NOT NULL DEFAULT 1,
  affected_tenant_count integer NOT NULL DEFAULT 0,
  last_error_code varchar(100),
  CONSTRAINT clerk_webhook_event_status_check
    CHECK (status IN ('received', 'processing', 'processed', 'ignored', 'failed')),
  CONSTRAINT clerk_webhook_event_attempts_check
    CHECK (attempts >= 1),
  CONSTRAINT clerk_webhook_event_tenant_count_check
    CHECK (affected_tenant_count >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS clerk_webhook_event_instance_id_unique
  ON clerk_webhook_event (instance_key, event_id);

CREATE INDEX IF NOT EXISTS clerk_webhook_event_status_received_idx
  ON clerk_webhook_event (status, received_at DESC);

CREATE INDEX IF NOT EXISTS clerk_webhook_event_user_received_idx
  ON clerk_webhook_event (clerk_user_id, received_at DESC);

ALTER TABLE listener_identity
  ADD COLUMN IF NOT EXISTS clerk_last_event_at timestamptz,
  ADD COLUMN IF NOT EXISTS clerk_deleted_at timestamptz;

ALTER TABLE listener_communication_preference
  ADD COLUMN IF NOT EXISTS phone_verified_at timestamptz;
