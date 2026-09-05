CREATE UNIQUE INDEX provider_operations_twilio_leg_attempt_idx
  ON provider_operations(call_attempt_id)
  WHERE provider = 'twilio' AND operation_type = 'telephony_leg';
