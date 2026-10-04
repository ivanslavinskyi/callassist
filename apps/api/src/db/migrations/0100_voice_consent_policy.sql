CREATE TABLE voice_consent_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  mode text NOT NULL CHECK (mode IN ('semantic_native','hybrid_deterministic_v1')),
  revision integer NOT NULL CHECK (revision>0),
  updated_at timestamptz,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reason text
);
INSERT INTO voice_consent_settings(id,mode,revision) VALUES(true,'semantic_native',1);
CREATE TABLE voice_consent_settings_audit (
  id uuid PRIMARY KEY,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reason text NOT NULL,
  previous_policy jsonb NOT NULL,
  next_policy jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE call_attempts ADD COLUMN consent_runtime_policy jsonb
  CHECK (consent_runtime_policy IS NULL OR jsonb_typeof(consent_runtime_policy)='object');
ALTER TABLE call_events DROP CONSTRAINT call_events_event_name_check;
ALTER TABLE call_events ADD CONSTRAINT call_events_event_name_check CHECK (event_name IN (
  'brief.created','compilation.completed','policy.evaluated','compilation.approved','attempt.started',
  'credit.reserved','provider.call_created','provider.status_changed','connection.confirmed','credit.settled',
  'disclosure.started','disclosure.completed','consent.decision','consent.granted','consent.failed',
  'recording.requested','recording.started','recording.completed','recording.failed',
  'realtime.ready','realtime.voice','realtime.error','conversation.started','conversation.first_audio','conversation.ended','conversation.hangup',
  'conversation.tool_result','conversation.task','transcription.started','transcription.completed','transcription.failed',
  'call.recovered','call.stop','answering.updated','provider.sip_response'
));
