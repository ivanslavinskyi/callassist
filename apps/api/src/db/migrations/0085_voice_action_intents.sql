-- Application-owned spoken appointment requests. A missing acknowledgement is not a safe retry.
CREATE TABLE call_voice_actions (
  id uuid PRIMARY KEY,
  call_brief_id uuid NOT NULL REFERENCES call_briefs(id) ON DELETE CASCADE,
  call_attempt_id uuid NOT NULL UNIQUE REFERENCES call_attempts(id) ON DELETE CASCADE,
  snapshot_hash text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  state text NOT NULL CHECK (state IN ('sending', 'delivered', 'uncertain', 'confirmed')),
  payload_ciphertext text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX call_voice_actions_brief_idx ON call_voice_actions(call_brief_id);

ALTER TABLE call_events DROP CONSTRAINT call_events_event_name_check;
ALTER TABLE call_events ADD CONSTRAINT call_events_event_name_check CHECK (event_name IN (
  'brief.created','compilation.completed','policy.evaluated','compilation.approved','attempt.started',
  'credit.reserved','provider.call_created','provider.status_changed','connection.confirmed','credit.settled',
  'disclosure.started','consent.granted','consent.failed','recording.started','recording.completed','recording.failed',
  'realtime.ready','conversation.started','conversation.first_audio','conversation.ended','conversation.hangup',
  'conversation.tool_result','conversation.task','transcription.started','transcription.completed','transcription.failed',
  'call.recovered','call.stop','answering.updated','provider.sip_response'
));
