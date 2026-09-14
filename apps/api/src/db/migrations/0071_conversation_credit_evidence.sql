-- Existing immutable ledger entries keep their historical settlement rule.
-- Segment IDs deliberately have no FK: deleting call content must remain possible.
ALTER TABLE credit_transactions ADD COLUMN qualification jsonb;
ALTER TABLE credit_transactions ADD CONSTRAINT credit_qualification_shape CHECK (
  qualification IS NULL OR COALESCE((
    type = 'call_charge' AND jsonb_typeof(qualification) = 'object'
    AND qualification->>'version' = '1'
    AND qualification ? 'questionSegmentId' AND qualification ? 'answerSegmentId'
    AND qualification->>'category' IN ('task_answer', 'cannot_answer', 'referral', 'message_acknowledged')
  ), false)
);
