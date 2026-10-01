import { getAppointmentAuthorization, summarySourceContextSchema, type CallTextArtifact, type SummarySourceContext } from "@callassist/contracts";
import { CallRepositoryError, type CallRepository } from "../storage/call-repository";
import { textPayloadHash } from "../storage/call-text-repository";

/** Resolve by original revision/attempt, never by the current editable brief. */
export async function buildSummarySourceContext(repository: CallRepository, artifact: CallTextArtifact): Promise<SummarySourceContext> {
  const source = artifact.transcriptRevisionId ? await repository.getTranscriptRevision(artifact.callId, artifact.transcriptRevisionId) : null;
  const attempt = source?.callAttemptId ? await repository.getAttempt(artifact.callId, source.callAttemptId) : null;
  const compilation = artifact.compilationId ? await repository.getTextArtifactSourceCompilation(artifact.callId, artifact.compilationId) : null;
  if (!source || !attempt || !compilation?.compiledBrief || source.sourceHash !== artifact.sourceHash || attempt.callBriefId !== artifact.callId ||
      attempt.compilationId !== artifact.compilationId || (attempt.compilationSnapshotHash && attempt.compilationSnapshotHash !== compilation.snapshotHash))
    throw new CallRepositoryError("TEXT_ARTIFACT_INVALID");
  const [events, data] = await Promise.all([repository.listCallTelemetryEvents(artifact.callId), repository.exportCallTextData(artifact.callId)]);
  const action = data.voiceActions?.find(a => a.callAttemptId === attempt.id && a.callBriefId === artifact.callId && a.snapshotHash === compilation.snapshotHash);
  // A 'completed' callback can establish historical connection, but its timestamp
  // is not the time the recipient answered. Use only observed in-progress evidence.
  const connected = events.find(e => e.callAttemptId === attempt.id && e.payload.name === "connection.confirmed" && e.payload.metadata.providerStatus === "in-progress");
  return summarySourceContextSchema.parse({ version: 1, callAttemptId: attempt.id, compilationId: artifact.compilationId,
    compilationSnapshotHash: compilation.snapshotHash, transcriptRevisionId: source.id, transcriptSourceHash: source.sourceHash,
    callCreatedAt: attempt.startedAt, callConnectedAt: connected?.occurredAt ?? null, callEndedAt: attempt.endedAt,
    approvedAt: attempt.executionSnapshot?.approvedAt ?? compilation.approvedAt,
    appointmentAuthorization: getAppointmentAuthorization(compilation.compiledBrief),
    actionEvidence: action ? { id: action.id, version: action.version, state: action.state,
      date: action.proposal.date, startTime: action.proposal.startTime, timeZone: action.proposal.timeZone } : null });
}

export function assertSummaryContext(artifact: CallTextArtifact) {
  const context = summarySourceContextSchema.parse(artifact.sourceContext);
  if (textPayloadHash(context) !== artifact.contextHash || context.compilationId !== artifact.compilationId ||
      context.transcriptRevisionId !== artifact.transcriptRevisionId || context.transcriptSourceHash !== artifact.sourceHash)
    throw new CallRepositoryError("TEXT_ARTIFACT_INVALID");
  return context;
}
