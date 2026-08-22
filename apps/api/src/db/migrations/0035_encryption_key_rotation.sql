ALTER TABLE call_feedback_revisions
  ADD COLUMN payload_fingerprint_key_id varchar(32) NOT NULL DEFAULT 'legacy-v1';

ALTER TABLE call_feedback_revisions
  ADD CONSTRAINT call_feedback_fingerprint_key_id_check CHECK (
    payload_fingerprint_key_id ~ '^[a-z][a-z0-9_-]{0,31}$'
  );

CREATE OR REPLACE FUNCTION prevent_call_outcome_revision_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF
    TG_OP = 'UPDATE'
    AND TG_TABLE_NAME = 'call_feedback_revisions'
    AND current_setting('callassist.encryption_rotation', true) = 'enabled'
    AND (
      to_jsonb(NEW) - ARRAY[
        'comment_ciphertext',
        'payload_fingerprint',
        'payload_fingerprint_key_id'
      ]
    ) = (
      to_jsonb(OLD) - ARRAY[
        'comment_ciphertext',
        'payload_fingerprint',
        'payload_fingerprint_key_id'
      ]
    )
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'call outcome and feedback revisions are immutable';
END;
$$;
