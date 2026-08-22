ALTER TABLE call_events
DROP CONSTRAINT call_events_event_name_check;

ALTER TABLE call_events
ADD CONSTRAINT call_events_event_name_check CHECK (event_name IN (
  'brief.created',
  'compilation.completed',
  'policy.evaluated',
  'compilation.approved',
  'attempt.started',
  'credit.reserved',
  'provider.call_created',
  'provider.status_changed',
  'connection.confirmed',
  'credit.settled',
  'disclosure.started',
  'consent.granted',
  'consent.failed',
  'recording.started',
  'recording.completed',
  'recording.failed',
  'realtime.ready',
  'conversation.started',
  'conversation.first_audio',
  'conversation.ended',
  'transcription.started',
  'transcription.completed',
  'transcription.failed',
  'call.recovered'
));
