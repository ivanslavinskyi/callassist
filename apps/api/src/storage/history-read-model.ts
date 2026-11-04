import { callCompilationSchema, durableCallEventSchema, type DurableCallEvent, type CallAssessmentRecord } from '@callassist/contracts';

// These diagnostic events are not inputs to deriveCallLifecycle. A newer writer
// must not make the owner's entire history unreadable. Preserve its watermark.
function unsupportedDiagnostic(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const callId = durableCallEventSchema.shape.callBriefId.safeParse(raw.callBriefId);
  const sequence = durableCallEventSchema.shape.sequence.safeParse(raw.sequence);
  if (!callId.success || !sequence.success || !raw.payload || typeof raw.payload !== 'object') return null;
  const payload = raw.payload as Record<string, unknown>;
  if (!['realtime.ready', 'conversation.task'].includes(String(payload.name)) || !payload.metadata || typeof payload.metadata !== 'object') return null;
  const version = (payload.metadata as Record<string, unknown>).runtimeVersion;
  if (typeof version !== 'string' || !version.length || version.length > 80) return null;
  return { callBriefId: callId.data, sequence: sequence.data };
}

export function readHistoryTelemetry(values: unknown[]) {
  const events: DurableCallEvent[] = [];
  const sequences = new Map<string, number>();
  for (const value of values) {
    let projection = value;
    // A later consent writer added an internal nativeDecision diagnostic. The
    // history view uses the stored method/affirmative decision, still validated
    // strictly below. This is never used for granting consent to a running call.
    if (value && typeof value === 'object' && 'payload' in value && value.payload && typeof value.payload === 'object') {
      const payload = value.payload as Record<string, unknown>;
      if (payload.name === 'consent.granted' && payload.metadata && typeof payload.metadata === 'object' && 'nativeDecision' in payload.metadata) {
        const { nativeDecision: _diagnostic, ...metadata } = payload.metadata;
        projection = { ...value, payload: { ...payload, metadata } };
      }
    }
    const parsed = durableCallEventSchema.safeParse(projection);
    const diagnostic = parsed.success ? null : unsupportedDiagnostic(value);
    if (!parsed.success && !diagnostic) throw parsed.error;
    const envelope = parsed.success ? parsed.data : diagnostic!;
    sequences.set(envelope.callBriefId, Math.max(sequences.get(envelope.callBriefId) ?? 0, envelope.sequence));
    if (parsed.success) events.push(parsed.data);
  }
  return { events, sequences };
}

// Optional display enrichment only. Unsupported plans retain the brief's own
// objective; approval/execution still use the strict compilation schema.
export function readHistoryCompilation(value: unknown) {
  const parsed = callCompilationSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function unavailableHistoryAssessment(record: CallAssessmentRecord): CallAssessmentRecord {
  return { ...record, decision: null, summary: { ...record.summary, status: 'unavailable',
    conversation: null, goal: null, reason: 'evidence_uncertain' } };
}
