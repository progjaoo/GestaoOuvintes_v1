CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migration (
  id varchar(255) PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE campaign (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug varchar(100) NOT NULL UNIQUE,
  name varchar(180) NOT NULL,
  title varchar(180) NOT NULL,
  description text NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'draft',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  privacy_notice_version varchar(30) NOT NULL,
  privacy_notice_url text NOT NULL,
  terms_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_status_check
    CHECK (status IN ('draft', 'active', 'paused', 'closed')),
  CONSTRAINT campaign_period_check
    CHECK (ends_at IS NULL OR ends_at > starts_at)
);

CREATE TABLE admin_user (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(160) NOT NULL,
  username varchar(100) NOT NULL,
  password_hash text NOT NULL,
  role varchar(30) NOT NULL DEFAULT 'admin',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  CONSTRAINT admin_user_role_check CHECK (role IN ('admin', 'viewer')),
  CONSTRAINT admin_user_username_lowercase_check CHECK (username = lower(username))
);

CREATE UNIQUE INDEX admin_user_username_unique_ci
  ON admin_user (lower(username));

CREATE TABLE listener_registration (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaign(id) ON DELETE RESTRICT,
  name varchar(160) NOT NULL,
  neighborhood varchar(120) NOT NULL,
  city varchar(120) NOT NULL,
  phone varchar(20),
  source varchar(50) NOT NULL DEFAULT 'institutional_web',
  submission_token uuid NOT NULL,
  privacy_notice_version varchar(30) NOT NULL,
  privacy_acknowledged_at timestamptz NOT NULL,
  marketing_opt_in boolean NOT NULL DEFAULT false,
  marketing_opt_in_at timestamptz,
  utm_source varchar(120),
  utm_medium varchar(120),
  utm_campaign varchar(120),
  utm_content varchar(120),
  ip_hash varchar(128),
  user_agent_summary varchar(255),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT listener_registration_name_check CHECK (char_length(btrim(name)) >= 2),
  CONSTRAINT listener_registration_neighborhood_check CHECK (char_length(btrim(neighborhood)) >= 2),
  CONSTRAINT listener_registration_city_check CHECK (char_length(btrim(city)) >= 2),
  CONSTRAINT listener_registration_marketing_date_check
    CHECK (
      (marketing_opt_in = false AND marketing_opt_in_at IS NULL)
      OR
      (marketing_opt_in = true AND marketing_opt_in_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX listener_registration_campaign_submission_unique
  ON listener_registration (campaign_id, submission_token);

CREATE INDEX listener_registration_campaign_created_idx
  ON listener_registration (campaign_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX listener_registration_city_idx
  ON listener_registration (lower(city))
  WHERE deleted_at IS NULL;

CREATE INDEX listener_registration_neighborhood_idx
  ON listener_registration (lower(neighborhood))
  WHERE deleted_at IS NULL;

CREATE INDEX listener_registration_phone_idx
  ON listener_registration (phone)
  WHERE phone IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE registration_export_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL REFERENCES admin_user(id) ON DELETE RESTRICT,
  campaign_id uuid REFERENCES campaign(id) ON DELETE RESTRICT,
  format varchar(10) NOT NULL,
  filters_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  row_count integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT registration_export_format_check CHECK (format IN ('xlsx', 'csv')),
  CONSTRAINT registration_export_row_count_check CHECK (row_count >= 0)
);

CREATE INDEX registration_export_audit_created_idx
  ON registration_export_audit (created_at DESC);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER campaign_set_updated_at
BEFORE UPDATE ON campaign
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER admin_user_set_updated_at
BEFORE UPDATE ON admin_user
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
