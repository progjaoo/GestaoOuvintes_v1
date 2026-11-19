-- Existing links were created by parser revision 1; future links record their exact revision.
ALTER TABLE radio_calendar_poll_link
  ADD COLUMN parser_revision integer NOT NULL DEFAULT 1
  CHECK (parser_revision >= 0);
