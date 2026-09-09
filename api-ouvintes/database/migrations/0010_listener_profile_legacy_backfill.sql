-- Complete historical consent/preference projections after the persistent
-- identity migration. This migration is idempotent and keeps the legacy
-- registration table as the source for historical consent evidence.

INSERT INTO listener_consent (
  tenant_id,
  listener_profile_id,
  consent_type,
  document_version,
  granted,
  source,
  created_at,
  revoked_at
)
SELECT DISTINCT ON (profile.id, registration.privacy_notice_version)
       registration.tenant_id,
       profile.id,
       'privacy_registration',
       registration.privacy_notice_version,
       true,
       registration.source,
       registration.privacy_acknowledged_at,
       NULL
  FROM listener_registration registration
  JOIN listener_profile profile
    ON profile.tenant_id = registration.tenant_id
   AND profile.phone_normalized = registration.phone_normalized
 WHERE registration.deleted_at IS NULL
   AND registration.phone_normalized IS NOT NULL
   AND profile.deleted_at IS NULL
   AND NOT EXISTS (
     SELECT 1
       FROM listener_consent consent
      WHERE consent.tenant_id = registration.tenant_id
        AND consent.listener_profile_id = profile.id
        AND consent.consent_type = 'privacy_registration'
        AND consent.document_version = registration.privacy_notice_version
   )
 ORDER BY profile.id, registration.privacy_notice_version, registration.created_at;

INSERT INTO listener_consent (
  tenant_id,
  listener_profile_id,
  consent_type,
  document_version,
  granted,
  source,
  created_at,
  revoked_at
)
SELECT DISTINCT ON (profile.id, registration.privacy_notice_version)
       registration.tenant_id,
       profile.id,
       'campaign_participation',
       registration.privacy_notice_version,
       true,
       registration.source,
       registration.privacy_acknowledged_at,
       NULL
  FROM listener_registration registration
  JOIN listener_profile profile
    ON profile.tenant_id = registration.tenant_id
   AND profile.phone_normalized = registration.phone_normalized
 WHERE registration.deleted_at IS NULL
   AND registration.phone_normalized IS NOT NULL
   AND profile.deleted_at IS NULL
   AND NOT EXISTS (
     SELECT 1
       FROM listener_consent consent
      WHERE consent.tenant_id = registration.tenant_id
        AND consent.listener_profile_id = profile.id
        AND consent.consent_type = 'campaign_participation'
        AND consent.document_version = registration.privacy_notice_version
   )
 ORDER BY profile.id, registration.privacy_notice_version, registration.created_at;

INSERT INTO listener_consent (
  tenant_id,
  listener_profile_id,
  consent_type,
  document_version,
  granted,
  source,
  created_at,
  revoked_at
)
SELECT DISTINCT ON (profile.id, registration.privacy_notice_version)
       registration.tenant_id,
       profile.id,
       'campaign_updates',
       registration.privacy_notice_version,
       registration.marketing_opt_in,
       registration.source,
       COALESCE(registration.marketing_opt_in_at, registration.created_at),
       CASE WHEN registration.marketing_opt_in THEN NULL ELSE registration.created_at END
  FROM listener_registration registration
  JOIN listener_profile profile
    ON profile.tenant_id = registration.tenant_id
   AND profile.phone_normalized = registration.phone_normalized
 WHERE registration.deleted_at IS NULL
   AND registration.phone_normalized IS NOT NULL
   AND profile.deleted_at IS NULL
   AND NOT EXISTS (
     SELECT 1
       FROM listener_consent consent
      WHERE consent.tenant_id = registration.tenant_id
        AND consent.listener_profile_id = profile.id
        AND consent.consent_type = 'campaign_updates'
        AND consent.document_version = registration.privacy_notice_version
   )
 ORDER BY profile.id, registration.privacy_notice_version, registration.created_at DESC;

INSERT INTO listener_communication_preference (tenant_id, listener_profile_id)
SELECT profile.tenant_id, profile.id
  FROM listener_profile profile
 WHERE NOT EXISTS (
   SELECT 1
     FROM listener_communication_preference preference
    WHERE preference.tenant_id = profile.tenant_id
      AND preference.listener_profile_id = profile.id
 );
