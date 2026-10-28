CREATE TABLE editorial_category (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(80) NOT NULL,
  slug varchar(90) NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT editorial_category_name_check CHECK (char_length(btrim(name)) BETWEEN 2 AND 80),
  CONSTRAINT editorial_category_slug_check CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

CREATE TABLE editorial_post (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug varchar(180) NOT NULL UNIQUE,
  category_id uuid NOT NULL REFERENCES editorial_category(id) ON DELETE RESTRICT,
  status varchar(20) NOT NULL DEFAULT 'draft',
  draft_revision_id uuid,
  published_revision_id uuid,
  first_published_at timestamptz,
  created_by_admin_user_id uuid REFERENCES admin_user(id) ON DELETE SET NULL,
  updated_by_admin_user_id uuid REFERENCES admin_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT editorial_post_status_check CHECK (status IN ('draft', 'published', 'archived')),
  CONSTRAINT editorial_post_slug_check CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

CREATE TABLE editorial_media_asset (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  media_type varchar(20) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'uploading',
  private_object_key varchar(1024) NOT NULL UNIQUE,
  public_object_key varchar(1024) UNIQUE,
  mime_type varchar(100) NOT NULL,
  byte_size bigint NOT NULL,
  width integer,
  height integer,
  duration_ms integer,
  frame_count integer,
  poster_object_key varchar(1024),
  private_variants jsonb NOT NULL DEFAULT '[]'::jsonb,
  checksum_sha256 varchar(64),
  original_name varchar(255) NOT NULL,
  created_by_admin_user_id uuid REFERENCES admin_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT editorial_media_type_check CHECK (media_type IN ('image', 'video', 'gif')),
  CONSTRAINT editorial_media_status_check CHECK (status IN ('uploading', 'ready', 'rejected', 'deleted')),
  CONSTRAINT editorial_media_size_check CHECK (byte_size > 0),
  CONSTRAINT editorial_media_dimensions_check CHECK ((width IS NULL AND height IS NULL) OR (width > 0 AND height > 0))
);

CREATE TABLE editorial_revision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES editorial_post(id) ON DELETE CASCADE,
  revision_number integer NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  title varchar(180) NOT NULL,
  excerpt varchar(320) NOT NULL,
  cover_asset_id uuid NOT NULL REFERENCES editorial_media_asset(id) ON DELETE RESTRICT,
  cover_alt varchar(220) NOT NULL,
  cover_focus_x numeric(5,2) NOT NULL DEFAULT 50,
  cover_focus_y numeric(5,2) NOT NULL DEFAULT 50,
  blocks jsonb NOT NULL DEFAULT '[]'::jsonb,
  category_snapshot jsonb NOT NULL,
  seo_title varchar(70) NOT NULL,
  seo_description varchar(180) NOT NULL,
  event_date date,
  public_credits varchar(500),
  created_by_admin_user_id uuid REFERENCES admin_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT editorial_revision_number_unique UNIQUE (post_id, revision_number),
  CONSTRAINT editorial_revision_schema_check CHECK (schema_version = 1),
  CONSTRAINT editorial_revision_focus_check CHECK (cover_focus_x BETWEEN 0 AND 100 AND cover_focus_y BETWEEN 0 AND 100),
  CONSTRAINT editorial_revision_blocks_check CHECK (jsonb_typeof(blocks) = 'array')
);

ALTER TABLE editorial_post
  ADD CONSTRAINT editorial_post_draft_revision_fk FOREIGN KEY (draft_revision_id) REFERENCES editorial_revision(id) ON DELETE SET NULL,
  ADD CONSTRAINT editorial_post_published_revision_fk FOREIGN KEY (published_revision_id) REFERENCES editorial_revision(id) ON DELETE SET NULL;

CREATE TABLE editorial_revision_asset (
  revision_id uuid NOT NULL REFERENCES editorial_revision(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES editorial_media_asset(id) ON DELETE RESTRICT,
  PRIMARY KEY (revision_id, asset_id)
);

CREATE TABLE editorial_release (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace varchar(120) NOT NULL,
  sequence bigint GENERATED ALWAYS AS IDENTITY,
  status varchar(30) NOT NULL DEFAULT 'preparing',
  revision_ids jsonb NOT NULL,
  manifest_key varchar(1024),
  manifest_sha256 varchar(64),
  deploy_job_id varchar(160),
  idempotency_key uuid NOT NULL,
  error_code varchar(80),
  created_by_admin_user_id uuid REFERENCES admin_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT editorial_release_status_check CHECK (status IN ('preparing', 'building', 'awaiting_confirmation', 'live', 'failed')),
  CONSTRAINT editorial_release_revision_ids_check CHECK (jsonb_typeof(revision_ids) = 'array')
);

CREATE UNIQUE INDEX editorial_release_one_active_per_namespace_idx
  ON editorial_release (namespace)
  WHERE status IN ('preparing', 'building', 'awaiting_confirmation');

CREATE INDEX editorial_post_public_order_idx
  ON editorial_post (first_published_at DESC, id DESC)
  WHERE status = 'published' AND archived_at IS NULL;

CREATE INDEX editorial_post_category_order_idx
  ON editorial_post (category_id, first_published_at DESC, id DESC)
  WHERE status = 'published' AND archived_at IS NULL;

CREATE INDEX editorial_media_owner_status_idx
  ON editorial_media_asset (created_by_admin_user_id, status, created_at DESC);

CREATE INDEX editorial_release_namespace_created_idx
  ON editorial_release (namespace, created_at DESC);
CREATE UNIQUE INDEX editorial_release_idempotency_unique
  ON editorial_release (namespace, idempotency_key);

INSERT INTO permission (key, description) VALUES
  ('feed.read', 'Consultar conteudo editorial do Feed'),
  ('feed.edit', 'Criar e editar rascunhos do Feed'),
  ('feed.publish', 'Solicitar publicacao e retirada do Feed'),
  ('feed.media.manage', 'Enviar e administrar midias do Feed')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r CROSS JOIN permission p
WHERE r.key = 'admin'
  AND p.key IN ('feed.read', 'feed.edit', 'feed.publish', 'feed.media.manage')
ON CONFLICT DO NOTHING;
