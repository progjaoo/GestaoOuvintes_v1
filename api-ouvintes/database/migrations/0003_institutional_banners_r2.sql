CREATE TABLE IF NOT EXISTS media_asset (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_provider varchar(20) NOT NULL DEFAULT 'r2',
  object_key varchar(1024) NOT NULL UNIQUE,
  original_name varchar(255) NOT NULL,
  mime_type varchar(100) NOT NULL,
  byte_size bigint NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  etag varchar(255),
  status varchar(20) NOT NULL DEFAULT 'ready',
  created_by_admin_user_id uuid REFERENCES admin_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT media_asset_status_check CHECK (status IN ('ready', 'orphaned', 'deleted')),
  CONSTRAINT media_asset_dimensions_check CHECK (width > 0 AND height > 0),
  CONSTRAINT media_asset_byte_size_check CHECK (byte_size > 0)
);

CREATE INDEX IF NOT EXISTS media_asset_status_created_idx
  ON media_asset (status, created_at DESC);

CREATE TABLE IF NOT EXISTS institutional_banner (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title varchar(160) NOT NULL,
  alt_text varchar(220) NOT NULL,
  placement_key varchar(80) NOT NULL DEFAULT 'home_hero',
  media_asset_id uuid NOT NULL REFERENCES media_asset(id) ON DELETE RESTRICT,
  destination_url varchar(2048),
  open_in_new_tab boolean NOT NULL DEFAULT false,
  display_order integer NOT NULL,
  active boolean NOT NULL DEFAULT false,
  created_by_admin_user_id uuid REFERENCES admin_user(id) ON DELETE SET NULL,
  updated_by_admin_user_id uuid REFERENCES admin_user(id) ON DELETE SET NULL,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT institutional_banner_display_order_check CHECK (display_order > 0),
  CONSTRAINT institutional_banner_placement_check CHECK (placement_key ~ '^[a-z0-9_:-]+$'),
  CONSTRAINT institutional_banner_title_check CHECK (char_length(btrim(title)) >= 2),
  CONSTRAINT institutional_banner_alt_check CHECK (char_length(btrim(alt_text)) >= 2)
);

CREATE INDEX IF NOT EXISTS institutional_banner_public_idx
  ON institutional_banner (placement_key, active, display_order, created_at)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS media_asset_set_updated_at ON media_asset;
CREATE TRIGGER media_asset_set_updated_at
BEFORE UPDATE ON media_asset
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS institutional_banner_set_updated_at ON institutional_banner;
CREATE TRIGGER institutional_banner_set_updated_at
BEFORE UPDATE ON institutional_banner
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO permission (key, description)
VALUES
  ('institutional_banner.read', 'Consultar banners institucionais'),
  ('institutional_banner.manage', 'Criar, editar, ordenar e publicar banners institucionais'),
  ('media.upload', 'Enviar midias para o armazenamento institucional')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r
JOIN permission p ON p.key IN (
  'institutional_banner.read',
  'institutional_banner.manage',
  'media.upload'
)
WHERE r.key = 'admin'
ON CONFLICT DO NOTHING;
