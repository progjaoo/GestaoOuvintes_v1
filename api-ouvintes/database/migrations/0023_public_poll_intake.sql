-- Local public intake. Existing listener identity and applied migration 0022 are preserved.
ALTER TABLE radio_poll ADD COLUMN mode varchar(10) NOT NULL DEFAULT 'mixed'
 CHECK(mode IN('vote','message','mixed'));
ALTER TABLE radio_poll ADD CONSTRAINT radio_poll_public_identity UNIQUE(radio_key,id);
ALTER TABLE radio_poll ALTER COLUMN allow_message SET DEFAULT true;
UPDATE radio_poll SET mode=CASE WHEN allow_message THEN 'mixed' ELSE 'vote' END;
ALTER TABLE radio_poll ADD CONSTRAINT radio_poll_mode_message_coherent CHECK(allow_message=(mode<>'vote'));
ALTER TABLE radio_poll ADD COLUMN image_url varchar(2048);
ALTER TABLE radio_program_participation ADD COLUMN neighborhood varchar(120);
CREATE OR REPLACE FUNCTION protect_radio_participation_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.id,NEW.radio_key,NEW.program_id,NEW.edition_id,NEW.poll_id,NEW.display_name,NEW.message,NEW.created_at,NEW.neighborhood)
 IS DISTINCT FROM ROW(OLD.id,OLD.radio_key,OLD.program_id,OLD.edition_id,OLD.poll_id,OLD.display_name,OLD.message,OLD.created_at,OLD.neighborhood) THEN
  RAISE EXCEPTION 'Participation content and origin are immutable' USING ERRCODE='23514';
 END IF;
 IF NEW.state='received' OR NEW.version<>OLD.version+1 OR NEW.moderated_at IS NULL THEN
  RAISE EXCEPTION 'Participation updates require versioned moderation' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
ALTER TABLE radio_poll_vote ADD CONSTRAINT radio_poll_vote_receipt_identity UNIQUE(radio_key,program_id,poll_id,id);
ALTER TABLE radio_program_participation ADD CONSTRAINT radio_participation_receipt_identity UNIQUE(radio_key,program_id,edition_id,poll_id,id);
CREATE TABLE radio_poll_submission (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 radio_key varchar(80) NOT NULL,program_id uuid NOT NULL,edition_id uuid NOT NULL,poll_id uuid NOT NULL,
 submission_id uuid NOT NULL,device_token_hash varchar(64) NOT NULL CHECK(device_token_hash ~ '^[a-f0-9]{64}$'),
 payload_hash varchar(64) NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
 listener_profile_id uuid REFERENCES listener_profile(id) ON DELETE RESTRICT,
 listener_device_id uuid REFERENCES listener_device(id) ON DELETE RESTRICT,
 identified boolean NOT NULL,privacy_accepted_at timestamptz,privacy_notice_version varchar(80),
 display_name varchar(160),neighborhood varchar(120),
 vote_id uuid,participation_id uuid,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(radio_key,poll_id,submission_id),UNIQUE(radio_key,poll_id,device_token_hash),
 CHECK(vote_id IS NOT NULL OR participation_id IS NOT NULL),
 CHECK((privacy_accepted_at IS NULL)=(privacy_notice_version IS NULL)),
 CHECK(participation_id IS NULL OR privacy_accepted_at IS NOT NULL),
 CHECK((identified AND listener_profile_id IS NOT NULL AND listener_device_id IS NOT NULL AND privacy_accepted_at IS NOT NULL AND privacy_notice_version IS NOT NULL)
 OR (NOT identified AND listener_profile_id IS NULL AND listener_device_id IS NULL AND display_name IS NULL AND neighborhood IS NULL)),
 FOREIGN KEY(radio_key,program_id,edition_id,poll_id) REFERENCES radio_poll(radio_key,program_id,edition_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(radio_key,program_id,poll_id,vote_id) REFERENCES radio_poll_vote(radio_key,program_id,poll_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(radio_key,program_id,edition_id,poll_id,participation_id) REFERENCES radio_program_participation(radio_key,program_id,edition_id,poll_id,id) ON DELETE RESTRICT
);
-- Acceptance is purpose-specific, not marketing consent or a verified identity.
CREATE TABLE radio_poll_identity_consent (
 radio_key varchar(80) NOT NULL,poll_id uuid NOT NULL,listener_profile_id uuid NOT NULL REFERENCES listener_profile(id) ON DELETE RESTRICT,
 listener_device_id uuid NOT NULL REFERENCES listener_device(id) ON DELETE RESTRICT,
 privacy_notice_version varchar(80) NOT NULL,accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(radio_key,poll_id,listener_device_id,privacy_notice_version),
 FOREIGN KEY(radio_key,poll_id) REFERENCES radio_poll(radio_key,id) ON DELETE RESTRICT
);
