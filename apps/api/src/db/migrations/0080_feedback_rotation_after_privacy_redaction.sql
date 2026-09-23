-- Preserve privacy redaction from 0040 and restore the narrowly scoped
-- encryption-rotation exception introduced in 0035.
CREATE OR REPLACE FUNCTION prevent_call_outcome_revision_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'call_feedback_revisions' AND TG_OP = 'UPDATE' THEN
    IF NEW.comment_ciphertext IS NULL
      AND (to_jsonb(NEW) - 'comment_ciphertext') =
        (to_jsonb(OLD) - 'comment_ciphertext')
    THEN
      RETURN NEW;
    END IF;

    IF current_setting('callassist.encryption_rotation', true) = 'enabled'
      AND (to_jsonb(NEW) - ARRAY[
        'comment_ciphertext', 'payload_fingerprint', 'payload_fingerprint_key_id'
      ]) = (to_jsonb(OLD) - ARRAY[
        'comment_ciphertext', 'payload_fingerprint', 'payload_fingerprint_key_id'
      ])
    THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'call outcome and feedback revisions are immutable';
END;
$$;
