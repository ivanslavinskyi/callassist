CREATE TABLE call_events (
  id uuid PRIMARY KEY,
  call_brief_id uuid NOT NULL REFERENCES call_briefs(id) ON DELETE CASCADE,
  call_attempt_id uuid REFERENCES call_attempts(id),
  user_id uuid REFERENCES users(id),
  sequence integer NOT NULL CHECK (sequence > 0),
  schema_version integer NOT NULL CHECK (schema_version = 1),
  event_name varchar(64) NOT NULL CHECK (event_name IN (
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
    'conversation.ended',
    'transcription.started',
    'transcription.completed',
    'transcription.failed',
    'call.recovered'
  )),
  source varchar(24) NOT NULL CHECK (source IN (
    'api', 'compiler', 'policy', 'credits', 'telephony', 'realtime',
    'recording', 'transcription', 'system'
  )),
  stage varchar(24) NOT NULL CHECK (stage IN (
    'brief', 'compilation', 'policy', 'approval', 'credit', 'provider',
    'connection', 'disclosure', 'consent', 'recording', 'realtime',
    'conversation', 'transcription', 'recovery'
  )),
  severity varchar(16) NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(metadata) = 'object'
    AND octet_length(metadata::text) <= 4096
  ),
  idempotency_key varchar(200) NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (call_brief_id, sequence),
  UNIQUE (call_brief_id, idempotency_key)
);

CREATE INDEX call_events_call_timeline_idx
  ON call_events(call_brief_id, sequence ASC);

CREATE INDEX call_events_attempt_timeline_idx
  ON call_events(call_attempt_id, sequence ASC)
  WHERE call_attempt_id IS NOT NULL;

CREATE INDEX call_events_stage_time_idx
  ON call_events(stage, occurred_at DESC);

CREATE FUNCTION prevent_call_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'call_events are immutable';
END;
$$;

CREATE TRIGGER call_events_immutable
BEFORE UPDATE OR DELETE ON call_events
FOR EACH ROW EXECUTE FUNCTION prevent_call_event_mutation();
