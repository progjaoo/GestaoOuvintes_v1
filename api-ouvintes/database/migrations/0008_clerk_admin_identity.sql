ALTER TABLE admin_user
  ADD COLUMN IF NOT EXISTS clerk_user_id varchar(255);

CREATE UNIQUE INDEX IF NOT EXISTS admin_user_clerk_user_id_unique
  ON admin_user (clerk_user_id)
  WHERE clerk_user_id IS NOT NULL;

ALTER TABLE admin_user
  DROP CONSTRAINT IF EXISTS admin_user_clerk_user_id_check;

ALTER TABLE admin_user
  ADD CONSTRAINT admin_user_clerk_user_id_check
  CHECK (clerk_user_id IS NULL OR char_length(btrim(clerk_user_id)) > 0);
