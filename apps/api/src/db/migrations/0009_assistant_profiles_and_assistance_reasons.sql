ALTER TABLE call_briefs
  RENAME COLUMN speech_impairment_disclosure TO assistance_disclosure;

ALTER TABLE call_briefs
  RENAME COLUMN speech_impairment_disclosure_ciphertext TO assistance_disclosure_ciphertext;

ALTER TABLE call_briefs
  ADD COLUMN assistant_profile_id varchar(32),
  ADD COLUMN assistance_reason varchar(32);

UPDATE call_briefs
SET assistant_profile_id = 'sebastian'
WHERE lower(agent_name) = 'sebastian'
  AND voice_gender = 'male';

UPDATE call_briefs
SET assistance_reason = 'speech_impairment';

ALTER TABLE call_briefs
  ALTER COLUMN assistance_reason SET NOT NULL;

ALTER TABLE call_briefs
  ADD CONSTRAINT call_briefs_assistant_profile_id_check
    CHECK (
      assistant_profile_id IS NULL OR assistant_profile_id IN (
        'sebastian',
        'daniel',
        'martin',
        'anna',
        'sofia',
        'maria'
      )
    ),
  ADD CONSTRAINT call_briefs_assistance_reason_check
    CHECK (assistance_reason IN ('speech_impairment', 'language_barrier'));
