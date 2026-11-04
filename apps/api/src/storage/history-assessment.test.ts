import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { expect, it, vi } from 'vitest';
import { callAssessmentDecisionSchema, type CallAssessmentRecord } from '@callassist/contracts';
import { encryptJson } from '../security/encryption';
import { PostgresCallAssessmentStore } from './postgres-call-assessment-store';

const key = Buffer.alloc(32, 29);
function fixture(payload: unknown) {
  const record: CallAssessmentRecord = { callAttemptId: randomUUID(), compilationId: randomUUID(), sourceHash: null, decision: null,
    summary: { status: 'ready', conversation: 'confirmed', goal: 'achieved', reason: null,
      updatedAt: '2026-11-02T10:00:00.000Z', deadlineAt: null, transcriptRevisionId: null, evaluatorVersion: null } };
  const row = { call_attempt_id: record.callAttemptId, compilation_id: record.compilationId, source_hash: null,
    artifact_id: randomUUID(), context_hash: 'context', transcript_revision_id: randomUUID(), evaluator_version: 'fixture',
    created_at: new Date('2026-11-02T11:00:00.000Z'), payload_ciphertext: encryptJson(payload, key) };
  const queries: string[] = [];
  const sql = ((parts: string[] & { raw?: unknown }) => {
    if (!parts.raw) return parts;
    queries.push(parts.join('?'));
    return Promise.resolve([row]);
  }) as unknown as postgres.Sql;
  const settle = vi.fn();
  return { store: new PostgresCallAssessmentStore(sql, key, settle), sql, record, row, settle, queries };
}

it('marks unsupported archive assessment unavailable only for history and does not fall back to an older success', async () => {
  const f = fixture({ futureAssessment: true });
  const original = structuredClone(f.record), ciphertext = f.row.payload_ciphertext;
  await expect(f.store.displayRevisions([f.record])).rejects.toThrow();
  const result = await f.store.displayRevisions([f.record], f.sql, true);
  expect(result[0]).toMatchObject({ decision: null, summary: {
    status: 'unavailable', conversation: null, goal: null, reason: 'evidence_uncertain' } });
  expect(f.record).toEqual(original);
  expect(f.row.payload_ciphertext).toBe(ciphertext);
  expect(f.settle).not.toHaveBeenCalled();
  expect(f.queries.every(query => query.startsWith('SELECT '))).toBe(true);
});

it('preserves supported assessment display in both strict and history reads', async () => {
  const decision = callAssessmentDecisionSchema.parse({ conversation: { status: 'confirmed', category: 'task_answer',
    questionSegmentId: 'segment.1', answerSegmentId: 'segment.2', answerQuote: 'Yes' },
    goal: { status: 'achieved', sourceSegmentIds: ['segment.2'] },
    criteria: [{ id: 'criterion.0', status: 'achieved', sourceSegmentIds: ['segment.2'] }] });
  const f = fixture(decision);
  const strict = await f.store.displayRevisions([f.record]);
  expect(await f.store.displayRevisions([f.record], f.sql, true)).toEqual(strict);
  expect(strict[0]).toMatchObject({ decision, summary: { status: 'ready', goal: 'achieved' } });
  expect(f.settle).not.toHaveBeenCalled();
});

it('does not hide archive decryption failures', async () => {
  const f = fixture({ futureAssessment: true });
  f.row.payload_ciphertext = 'corrupted';
  await expect(f.store.displayRevisions([f.record], f.sql, true)).rejects.toThrow();
  expect(f.settle).not.toHaveBeenCalled();
});
