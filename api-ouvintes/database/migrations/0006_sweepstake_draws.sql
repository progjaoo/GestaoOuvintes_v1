CREATE TABLE IF NOT EXISTS sweepstake_draw (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaign(id) ON DELETE RESTRICT,
  sequence integer NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'selected',
  winner_participation_id uuid NOT NULL REFERENCES campaign_participation(id) ON DELETE RESTRICT,
  root_draw_id uuid REFERENCES sweepstake_draw(id) ON DELETE RESTRICT,
  previous_draw_id uuid REFERENCES sweepstake_draw(id) ON DELETE RESTRICT,
  executed_by_admin_user_id uuid NOT NULL REFERENCES admin_user(id) ON DELETE RESTRICT,
  algorithm varchar(80) NOT NULL,
  eligible_count integer NOT NULL,
  entries_hash varchar(64) NOT NULL,
  reason_code varchar(80),
  request_token uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  CONSTRAINT sweepstake_draw_sequence_check CHECK (sequence > 0),
  CONSTRAINT sweepstake_draw_eligible_count_check CHECK (eligible_count > 0),
  CONSTRAINT sweepstake_draw_status_check
    CHECK (status IN ('selected', 'superseded', 'cancelled')),
  CONSTRAINT sweepstake_draw_entries_hash_check
    CHECK (entries_hash ~ '^[a-f0-9]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS sweepstake_draw_campaign_sequence_unique
  ON sweepstake_draw (campaign_id, sequence);

CREATE UNIQUE INDEX IF NOT EXISTS sweepstake_draw_campaign_selected_unique
  ON sweepstake_draw (campaign_id)
  WHERE status = 'selected';

CREATE INDEX IF NOT EXISTS sweepstake_draw_campaign_created_idx
  ON sweepstake_draw (campaign_id, created_at DESC);

CREATE INDEX IF NOT EXISTS sweepstake_draw_winner_idx
  ON sweepstake_draw (winner_participation_id);

CREATE TABLE IF NOT EXISTS sweepstake_draw_entry (
  draw_id uuid NOT NULL REFERENCES sweepstake_draw(id) ON DELETE RESTRICT,
  participation_id uuid NOT NULL REFERENCES campaign_participation(id) ON DELETE RESTRICT,
  ordinal integer NOT NULL,
  PRIMARY KEY (draw_id, participation_id),
  CONSTRAINT sweepstake_draw_entry_ordinal_check CHECK (ordinal >= 0),
  CONSTRAINT sweepstake_draw_entry_draw_ordinal_unique UNIQUE (draw_id, ordinal)
);

CREATE INDEX IF NOT EXISTS sweepstake_draw_entry_participation_idx
  ON sweepstake_draw_entry (participation_id);

INSERT INTO permission (key, description)
VALUES
  ('sweepstake.read', 'Consultar apuracoes de sorteios'),
  ('sweepstake.draw', 'Executar o primeiro sorteio de uma campanha'),
  ('sweepstake.redraw', 'Executar novo sorteio preservando a auditoria')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r
JOIN permission p ON p.key IN (
  'sweepstake.read',
  'sweepstake.draw',
  'sweepstake.redraw'
)
WHERE r.key = 'admin'
ON CONFLICT DO NOTHING;


INSERT INTO admin_user_role (admin_user_id, role_id)
SELECT au.id, r.id
FROM admin_user au
JOIN role r ON r.key = au.role
ON CONFLICT DO NOTHING;
