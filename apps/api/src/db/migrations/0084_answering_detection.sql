-- Add durable answer detection and diagnostic SIP facts; retain all historical events.
ALTER TABLE call_events DROP CONSTRAINT call_events_event_name_check;
ALTER TABLE call_events ADD CONSTRAINT call_events_event_name_check CHECK (event_name IN (
  'brief.created', 'compilation.completed', 'policy.evaluated',
  'compilation.approved', 'attempt.started', 'credit.reserved',
  'provider.call_created', 'provider.status_changed', 'connection.confirmed',
  'credit.settled', 'disclosure.started', 'consent.granted', 'consent.failed',
  'recording.started', 'recording.completed', 'recording.failed', 'realtime.ready',
  'conversation.started', 'conversation.first_audio', 'conversation.ended',
  'conversation.hangup', 'conversation.tool_result', 'transcription.started',
  'transcription.completed', 'transcription.failed', 'call.recovered', 'call.stop', 'answering.updated', 'provider.sip_response'
));

ALTER TABLE durable_jobs DROP CONSTRAINT durable_jobs_job_type_check, DROP CONSTRAINT durable_jobs_target_check;
ALTER TABLE durable_jobs ADD CONSTRAINT durable_jobs_job_type_check CHECK (job_type IN (
  'brief_compilation','final_transcription','recording_retention','answer_detection_timeout','provider_call_reconciliation',
  'provider_call_cost_reconciliation','provider_recording_reconciliation','text_artifact_generation'));
ALTER TABLE durable_jobs ADD CONSTRAINT durable_jobs_target_check CHECK (
  (job_type = 'text_artifact_generation' AND text_artifact_id IS NOT NULL AND recording_id IS NULL AND call_attempt_id IS NULL AND call_preparation_id IS NULL)
  OR (text_artifact_id IS NULL AND (
    (job_type = 'brief_compilation' AND call_preparation_id IS NOT NULL AND call_attempt_id IS NULL AND recording_id IS NULL)
    OR (job_type IN ('answer_detection_timeout','provider_call_reconciliation','provider_call_cost_reconciliation') AND call_attempt_id IS NOT NULL AND call_preparation_id IS NULL AND recording_id IS NULL)
    OR (job_type IN ('final_transcription','recording_retention','provider_recording_reconciliation') AND recording_id IS NOT NULL AND call_attempt_id IS NULL AND call_preparation_id IS NULL)
  )));

ALTER TABLE provider_operations DROP CONSTRAINT provider_operations_operation_type_check;
ALTER TABLE provider_operations ADD CONSTRAINT provider_operations_operation_type_check CHECK (operation_type IN (
 'brief_moderation','brief_compilation','realtime_session','realtime_response','telephony_leg','transcription','text_translation','call_summary','answering_detection','voicemail_tts'));
CREATE UNIQUE INDEX provider_operations_answering_once ON provider_operations(call_attempt_id,operation_type)
 WHERE operation_type IN ('answering_detection','voicemail_tts');
