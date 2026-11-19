-- Safe calendar projection: retain only title and temporal metadata needed by the admin calendar.
ALTER TABLE radio_calendar_event_stage
  ADD COLUMN event_summary varchar(500),
  ADD COLUMN event_program_id uuid,
  ADD COLUMN event_start_date date,
  ADD COLUMN event_end_date date,
  ADD COLUMN event_starts_at timestamptz,
  ADD COLUMN event_ends_at timestamptz,
  ADD COLUMN event_all_day boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT radio_calendar_stage_program_fk
    FOREIGN KEY (radio_key, event_program_id) REFERENCES radio_program(radio_key, id) ON DELETE RESTRICT,
  ADD CONSTRAINT radio_calendar_stage_window_check
    CHECK ((event_starts_at IS NULL) = (event_ends_at IS NULL));

-- Recover the display window for already-valid staged previews. Invalid items get their
-- missing safe metadata on the next parser-revision full sync.
UPDATE radio_calendar_event_stage
SET event_summary = left(payload #>> '{poll,question}', 500),
    event_program_id = NULLIF(payload ->> 'programId', '')::uuid,
    event_starts_at = (payload #>> '{poll,startsAt}')::timestamptz,
    event_ends_at = (payload #>> '{poll,endsAt}')::timestamptz,
    event_start_date = ((payload #>> '{poll,startsAt}')::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date,
    event_end_date = ((payload #>> '{poll,endsAt}')::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
WHERE payload #>> '{poll,startsAt}' IS NOT NULL
  AND payload #>> '{poll,endsAt}' IS NOT NULL;

CREATE INDEX radio_calendar_stage_all_day_window
  ON radio_calendar_event_stage(radio_key, event_start_date, id)
  WHERE event_all_day AND event_start_date IS NOT NULL;
CREATE INDEX radio_calendar_stage_timed_window
  ON radio_calendar_event_stage(radio_key, event_starts_at, id)
  WHERE NOT event_all_day AND event_starts_at IS NOT NULL;
