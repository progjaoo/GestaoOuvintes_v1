-- Secure, one-time listener continuity handoff.
-- This migration is additive and keeps the legacy registration projection intact.

CREATE TABLE IF NOT EXISTS listener_recovery_handoff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  listener_identity_id uuid NOT NULL REFERENCES listener_identity(id) ON DELETE RESTRICT,
  source_device_id uuid NOT NULL REFERENCES listener_device(id) ON DELETE RESTRICT,
  token_hash varchar(128) NOT NULL,
  purpose varchar(40) NOT NULL DEFAULT 'listener_profile',
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT listener_recovery_handoff_purpose_check
    CHECK (purpose IN ('listener_profile')),
  CONSTRAINT listener_recovery_handoff_state_check
    CHECK (NOT (consumed_at IS NOT NULL AND revoked_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS listener_recovery_handoff_token_idx
  ON listener_recovery_handoff (tenant_id, token_hash);

CREATE INDEX IF NOT EXISTS listener_recovery_handoff_identity_idx
  ON listener_recovery_handoff (tenant_id, listener_identity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS listener_recovery_handoff_expiry_idx
  ON listener_recovery_handoff (tenant_id, expires_at);

CREATE INDEX IF NOT EXISTS listener_recovery_handoff_source_device_idx
  ON listener_recovery_handoff (tenant_id, source_device_id, created_at DESC);
