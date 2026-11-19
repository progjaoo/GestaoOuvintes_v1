ALTER TABLE media_asset ADD COLUMN program_edge_color varchar(7);
ALTER TABLE media_asset ADD CONSTRAINT media_asset_program_edge_color_check
  CHECK (program_edge_color IS NULL OR program_edge_color ~ '^#[0-9A-Fa-f]{6}$');
