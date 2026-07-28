ALTER TABLE institutional_banner
  ADD COLUMN action_type varchar(40) NOT NULL DEFAULT 'none';

UPDATE institutional_banner
SET
  action_type = CASE
    WHEN destination_url IS NOT NULL THEN 'external_url'
    ELSE 'none'
  END,
  open_in_new_tab = CASE
    WHEN destination_url IS NOT NULL THEN open_in_new_tab
    ELSE false
  END;

ALTER TABLE institutional_banner
  ADD CONSTRAINT institutional_banner_action_type_check
  CHECK (
    action_type IN (
      'none',
      'external_url',
      'listener_registration_modal'
    )
  );

ALTER TABLE institutional_banner
  ADD CONSTRAINT institutional_banner_action_state_check
  CHECK (
    (
      action_type = 'external_url'
      AND destination_url IS NOT NULL
    )
    OR
    (
      action_type IN ('none', 'listener_registration_modal')
      AND destination_url IS NULL
      AND open_in_new_tab = false
    )
  );
