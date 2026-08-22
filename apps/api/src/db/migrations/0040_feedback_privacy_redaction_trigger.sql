CREATE OR REPLACE FUNCTION prevent_call_outcome_revision_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'call_feedback_revisions' THEN
    IF
      TG_OP = 'UPDATE'
      AND NEW.comment_ciphertext IS NULL
      AND (to_jsonb(NEW) - 'comment_ciphertext') =
        (to_jsonb(OLD) - 'comment_ciphertext')
    THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'call outcome and feedback revisions are immutable';
END;
$$;
