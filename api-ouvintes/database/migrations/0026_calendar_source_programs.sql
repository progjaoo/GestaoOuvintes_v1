-- A source has one default program and may explicitly allow other programs
-- selected by an operator. Event descriptions can only choose within this list.
CREATE TABLE radio_calendar_source_program (
  radio_key varchar(80) NOT NULL,
  source_id uuid NOT NULL,
  program_id uuid NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (radio_key, source_id, program_id),
  FOREIGN KEY (radio_key, source_id) REFERENCES radio_calendar_source(radio_key, id) ON DELETE RESTRICT,
  FOREIGN KEY (radio_key, program_id) REFERENCES radio_program(radio_key, id) ON DELETE RESTRICT
);
CREATE INDEX radio_calendar_source_program_active ON radio_calendar_source_program(radio_key, program_id)
  WHERE active;

INSERT INTO radio_calendar_source_program(radio_key, source_id, program_id)
SELECT radio_key, id, program_id FROM radio_calendar_source
ON CONFLICT DO NOTHING;
