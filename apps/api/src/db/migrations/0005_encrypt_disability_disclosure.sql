ALTER TABLE call_briefs
  ADD COLUMN speech_impairment_disclosure_ciphertext text,
  ALTER COLUMN speech_impairment_disclosure DROP DEFAULT,
  ALTER COLUMN speech_impairment_disclosure DROP NOT NULL;

UPDATE call_briefs
SET speech_impairment_disclosure = NULL;
