ALTER TABLE editorial_revision
  ADD COLUMN opening_asset_id uuid REFERENCES editorial_media_asset(id) ON DELETE RESTRICT,
  ADD COLUMN opening_alt varchar(220),
  ADD COLUMN opening_focus_x numeric(5,2),
  ADD COLUMN opening_focus_y numeric(5,2);

UPDATE editorial_revision
SET opening_asset_id = cover_asset_id,
    opening_alt = cover_alt,
    opening_focus_x = cover_focus_x,
    opening_focus_y = cover_focus_y;

ALTER TABLE editorial_revision
  ALTER COLUMN opening_asset_id SET NOT NULL,
  ALTER COLUMN opening_alt SET NOT NULL,
  ALTER COLUMN opening_focus_x SET DEFAULT 50,
  ALTER COLUMN opening_focus_x SET NOT NULL,
  ALTER COLUMN opening_focus_y SET DEFAULT 50,
  ALTER COLUMN opening_focus_y SET NOT NULL,
  ADD CONSTRAINT editorial_revision_opening_alt_check CHECK (char_length(btrim(opening_alt)) BETWEEN 2 AND 220),
  ADD CONSTRAINT editorial_revision_opening_focus_check CHECK (opening_focus_x BETWEEN 0 AND 100 AND opening_focus_y BETWEEN 0 AND 100);

INSERT INTO editorial_revision_asset (revision_id, asset_id)
SELECT id, opening_asset_id FROM editorial_revision
ON CONFLICT DO NOTHING;
