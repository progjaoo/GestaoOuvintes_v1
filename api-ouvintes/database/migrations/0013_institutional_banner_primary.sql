ALTER TABLE institutional_banner
  ADD COLUMN is_primary boolean NOT NULL DEFAULT false;

ALTER TABLE institutional_banner
  ADD CONSTRAINT institutional_banner_primary_state_check
  CHECK (
    NOT is_primary OR (
      active AND deleted_at IS NULL AND placement_key = 'home_hero'
    )
  );

CREATE UNIQUE INDEX institutional_banner_one_primary_per_placement_idx
  ON institutional_banner (placement_key)
  WHERE is_primary AND deleted_at IS NULL;
