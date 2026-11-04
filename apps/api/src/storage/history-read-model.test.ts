import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { describeCallTelemetryEvent, durableCallEventSchema, callCompilationSchema, callHistoryItemSchema, callBriefSchema, CALL_BRIEF_INPUT_LIMITS, normalizeCreateCallBriefInput } from '@callassist/contracts';
import { DeterministicBriefCompiler } from '../brief-compiler/brief-compiler';
import { readHistoryCompilation, readHistoryTelemetry } from './history-read-model';

const callId = randomUUID();
function event(name: Parameters<typeof describeCallTelemetryEvent>[0], sequence: number, metadata: unknown) {
  return { id: randomUUID(), callBriefId: callId, callAttemptId: null, userId: null, sequence, schemaVersion: 1,
    ...describeCallTelemetryEvent(name), occurredAt: '2026-11-02T12:00:00.000Z', payload: { name, metadata } };
}

describe('read-only history compatibility', () => {
  it('reads oversized archive objectives without relaxing new brief validation', async () => {
    const { InMemoryCallRepository } = await import('./in-memory-call-repository');
    const repository = new InMemoryCallRepository();
    const input = normalizeCreateCallBriefInput({ recipientName: 'Office', phoneNumber: '+41523686688', objective: 'Ask office hours',
      assistantProfileId: 'sebastian', representedPersonFirstName: 'Test', representedPersonLastName: 'Owner', locale: 'en-GB', allowedFacts: [] });
    const brief = await repository.create(input, await new DeterministicBriefCompiler().compile(input), randomUUID());
    const objective = 'x'.repeat(CALL_BRIEF_INPUT_LIMITS.objective + 1);
    const archived = { ...brief, objective, feedback: null };
    expect(callHistoryItemSchema.parse(archived).objective).toBe(objective);
    expect(callBriefSchema.safeParse(archived).success).toBe(false);
    expect(() => normalizeCreateCallBriefInput({ ...input, objective })).toThrow();
  });
  it('preserves valid events and the watermark of unsupported diagnostics without fabricating lifecycle evidence', () => {
    const known = event('realtime.ready', 1, { model: 'gpt-live-1', transcriptionModel: 'gpt-live-1', runtimeVersion: 'live-managed-v9' });
    const future = event('realtime.ready', 2, { runtimeVersion: 'live-simple-decisions-v2' });
    const task = event('conversation.task', 3, { runtimeVersion: 'live-managed-v25', phase: 'future' });
    expect(durableCallEventSchema.safeParse(future).success).toBe(false);
    const result = readHistoryTelemetry([known, future, task]);
    expect(result.events).toEqual([known]);
    expect(result.sequences.get(callId)).toBe(3);
    expect(durableCallEventSchema.safeParse(future).success).toBe(false);
  });
  it.each(['consent.granted', 'credit.settled', 'provider.status_changed'] as const)('does not silently drop invalid %s evidence', name => {
    expect(() => readHistoryTelemetry([event(name, 1, { runtimeVersion: 'future' })])).toThrow();
  });
  it('rejects an invalid diagnostic envelope', () => {
    expect(() => readHistoryTelemetry([{ ...event('conversation.task', 1, { runtimeVersion: 'future' }), sequence: -1 }])).toThrow();
  });
  it('reads later consent diagnostics without changing the stored decision or the write validator', () => {
    const metadata = { method: 'voice', decision: 'affirmative', locale: 'en-GB', callAttemptId: randomUUID(), nativeDecision: { version: 'future' } };
    const stored = event('consent.granted', 1, metadata);
    expect(durableCallEventSchema.safeParse(stored).success).toBe(false);
    expect(readHistoryTelemetry([stored]).events[0]?.payload).toEqual({ name: 'consent.granted', metadata: {
      method: metadata.method, decision: metadata.decision, locale: metadata.locale, callAttemptId: metadata.callAttemptId } });
    expect(stored.payload.metadata).toBe(metadata);
    expect(durableCallEventSchema.safeParse(stored).success).toBe(false);
    expect(() => readHistoryTelemetry([event('consent.granted', 1, { ...metadata, decision: 'negative' })])).toThrow();
  });
  it('uses known display enrichment but never coerces a future plan into an executable compilation', async () => {
    const input = normalizeCreateCallBriefInput({ recipientName: 'Office', phoneNumber: '+41523686688', objective: 'Ask office hours',
      assistantProfileId: 'sebastian', representedPersonFirstName: 'Test', representedPersonLastName: 'Owner', locale: 'en-GB', allowedFacts: [] });
    const compilation = await new DeterministicBriefCompiler().compile(input);
    expect(readHistoryCompilation(compilation)).toEqual(compilation);
    const future = { ...compilation, compilerVersion: 'compiler-future-test', compiledBrief: { ...compilation.compiledBrief, schemaVersion: '999' } };
    expect(readHistoryCompilation(future)).toBeNull();
    expect(callCompilationSchema.safeParse(future).success).toBe(false);
    expect(future.compiledBrief.schemaVersion).toBe('999');
  });
});
