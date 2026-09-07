import { requireTestDatabaseUrl } from "../db/require-test-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  normalizeCreateCallBriefInput,
  type CreateCallBriefInput
} from "@callassist/contracts";
import postgres from "postgres";
import { DeterministicBriefCompiler } from "../brief-compiler/brief-compiler";
import { runMigrations } from "../db/migrate";
import { encryptJson } from "../security/encryption";
import { PostgresCallRepository } from "./postgres-call-repository";
import {
  decodeCallBriefCursor,
  type CallAdmissionPolicy
} from "./call-repository";

const ledgerTestPolicy: CallAdmissionPolicy = {
  maxStartsPerHour: 20,
  maxStartsPerDay: 20,
  maxStartsPerRecipientPerDay: 20,
  maxDurationSeconds: 900
};

const databaseUrl = requireTestDatabaseUrl();


describe("PostgresCallRepository", () => {
  const encryptionKey = Buffer.alloc(32, 7);
  let repository: PostgresCallRepository;
  let inspection: postgres.Sql;
  const ownerA = randomUUID();
  const ownerB = randomUUID();

  beforeAll(async () => {
    await runMigrations(databaseUrl);
    repository = new PostgresCallRepository(databaseUrl!, encryptionKey);
    inspection = postgres(databaseUrl!, { max: 1 });
    await inspection`DELETE FROM durable_worker_heartbeats`;
    const suffix = ownerA.replaceAll("-", "");
    await inspection`
      INSERT INTO users (
        id, email, password_hash, phone_e164, phone_verified_at,
        first_name, last_name, role, status, ui_locale, created_at
      ) VALUES
        (${ownerA}, ${`owner-a-${suffix}@example.com`}, 'test-only', ${`+417${suffix.slice(0, 8)}`}, now(), 'Nina', 'Keller', 'user', 'active', 'en', now()),
        (${ownerB}, ${`owner-b-${suffix}@example.com`}, 'test-only', ${`+418${suffix.slice(0, 8)}`}, now(), 'Leo', 'Meier', 'user', 'active', 'en', now())
    `;
  });

  afterAll(async () => {
    await Promise.all([repository?.close(), inspection?.end()]);
  });

  it("paginates and filters call briefs in PostgreSQL", async () => {
    const compiler = new DeterministicBriefCompiler();
    for (const recipientName of ["Cursor test Alpha", "Cursor test Beta"]) {
      const input: CreateCallBriefInput = {
        recipientName,
        phoneNumber: "+41710000009",
        objective: `Ask ${recipientName} for office hours`,
        assistantProfileId: "sebastian",
        representedPersonFirstName: "Nina",
        representedPersonLastName: "Keller",
        assistanceReason: "speech_impairment",
        locale: "en-GB",
        allowLanguageSwitch: false,
        allowedFacts: []
      };
      await repository.create(
        input,
        await compiler.compile(normalizeCreateCallBriefInput(input)),
        ownerA
      );
    }

    const first = await repository.list({ limit: 1, search: "Cursor test", userId: ownerA });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBeTypeOf("string");
    const cursor = decodeCallBriefCursor(first.nextCursor!);
    expect(cursor).not.toBeNull();
    const second = await repository.list({
      limit: 1,
      search: "Cursor test",
      userId: ownerA,
      status: "review_required",
      cursor: cursor!
    });
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
    await expect(repository.list({
      limit: 10,
      search: "Cursor test",
      userId: ownerB
    })).resolves.toMatchObject({ items: [] });
    await expect(repository.isOwnedBy(first.items[0]!.id, ownerA)).resolves.toBe(true);
    await expect(repository.isOwnedBy(first.items[0]!.id, ownerB)).resolves.toBe(false);
  });

  it("returns privacy-minimized recipient suggestions for one owner", async () => {
    const compiler = new DeterministicBriefCompiler();
    const createRecipient = async (
      recipientName: string,
      phoneNumber: string,
      userId: string
    ) => {
      const input: CreateCallBriefInput = {
        recipientName,
        phoneNumber,
        objective: "Ask the suggestion test recipient for office hours",
        assistantProfileId: "sebastian",
        representedPersonFirstName: "Nina",
        representedPersonLastName: "Keller",
        assistanceReason: "speech_impairment",
        locale: "en-GB",
        allowLanguageSwitch: false,
        allowedFacts: []
      };
      return repository.create(
        input,
        await compiler.compile(normalizeCreateCallBriefInput(input)),
        userId
      );
    };

    await createRecipient("Suggestion test Clinic", "+41710000011", ownerA);
    await createRecipient("Suggestion  test Clinic", "+41710000011", ownerA);
    await createRecipient("Suggestion test Clinic", "+41710000012", ownerA);
    await createRecipient("Suggestion test Other Owner", "+41710000014", ownerB);
    const deleted = await createRecipient(
      "Suggestion test Deleted",
      "+41710000013",
      ownerA
    );
    await inspection`
      UPDATE call_briefs
      SET data_deleted_at = now()
      WHERE id = ${deleted.id}
    `;

    const suggestions = await repository.listRecipientSuggestions({
      userId: ownerA,
      query: "Suggestion",
      limit: 10
    });
    expect(suggestions.items).toHaveLength(2);
    expect(suggestions.items.map(({ phoneNumber }) => phoneNumber).sort())
      .toEqual(["+41710000011", "+41710000012"]);
    expect(JSON.stringify(suggestions)).not.toContain("Other Owner");
    expect(JSON.stringify(suggestions)).not.toContain("Deleted");

    await expect(repository.listRecipientSuggestions({
      userId: ownerA,
      query: "+41710000012",
      limit: 1
    })).resolves.toMatchObject({
      items: [expect.objectContaining({ phoneNumber: "+41710000012" })]
    });
  });

  it("deduplicates concurrent call-brief creation by idempotency key", async () => {
    const input: CreateCallBriefInput = {
      recipientName: "Concurrent retry office",
      phoneNumber: "+41710000006",
      objective: "Verify concurrent preparation retries create one brief",
      assistantProfileId: "sebastian",
      representedPersonFirstName: "Nina",
      representedPersonLastName: "Keller",
      assistanceReason: "speech_impairment",
      locale: "en-GB",
      allowLanguageSwitch: false,
      allowedFacts: []
    };
    const compilation = await new DeterministicBriefCompiler().compile(
      normalizeCreateCallBriefInput(input)
    );
    const idempotencyKey = randomUUID();

    const [first, retry] = await Promise.all([
      repository.create(input, compilation, ownerA, idempotencyKey),
      repository.create(input, compilation, ownerA, idempotencyKey)
    ]);

    expect(retry.id).toBe(first.id);
    await expect(
      repository.findByCreationRequest(ownerA, idempotencyKey)
    ).resolves.toMatchObject({ id: first.id });
    const [count] = await inspection<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM call_briefs
      WHERE creation_idempotency_key = ${idempotencyKey}
    `;
    expect(count?.count).toBe(1);
  });

  it("atomically redacts owner call content and preserves immutable minimized evidence", async () => {
    const input: CreateCallBriefInput = {
      recipientName: "Deletion test clinic",
      phoneNumber: "+41710000007",
      objective: "Ask whether the private deletion test application was received",
      assistantProfileId: "sebastian",
      representedPersonFirstName: "Nina",
      representedPersonLastName: "Keller",
      assistanceReason: "speech_impairment",
      context: "Private deletion context",
      locale: "en-GB",
      allowLanguageSwitch: false,
      allowedFacts: ["Private deletion reference 149"]
    };
    const compilation = await new DeterministicBriefCompiler().compile(
      normalizeCreateCallBriefInput(input)
    );
    const brief = await repository.create(input, compilation, ownerA);
    await repository.approveCompilation(brief.id);
    await repository.addTranscript(
      brief.id,
      "recipient",
      "Private realtime transcript",
      "en-GB"
    );
    await repository.updateStatus(brief.id, "completed");
    await repository.submitOwnerCallFeedback(brief.id, ownerA, {
      idempotencyKey: randomUUID(),
      goalResult: "yes",
      transcriptQuality: null,
      comment: "Private feedback comment"
    });
    const attemptId = randomUUID();
    const jobId = randomUUID();
    const [attemptPlan] = await inspection<{
      compilationId: string;
      revision: number;
      snapshotHash: string;
      executionSnapshotCiphertext: string;
    }[]>`
      SELECT
        call_compilations.id AS "compilationId",
        call_compilations.revision,
        call_compilations.snapshot_hash AS "snapshotHash",
        call_compilation_approvals.execution_snapshot_ciphertext
          AS "executionSnapshotCiphertext"
      FROM call_briefs
      JOIN call_compilations
        ON call_compilations.id = call_briefs.current_compilation_id
      JOIN call_compilation_approvals
        ON call_compilation_approvals.compilation_id = call_compilations.id
      WHERE call_briefs.id = ${brief.id}
    `;
    await inspection`
      INSERT INTO call_attempts (
        id, call_brief_id, user_id, provider, provider_call_id,
        status, provider_status, compilation_id, compilation_revision,
        compilation_snapshot_hash, execution_snapshot_ciphertext,
        started_at, ended_at, created_at
      ) VALUES (
        ${attemptId}, ${brief.id}, ${ownerA}, 'twilio', 'CA-private-delete',
        'completed', 'completed', ${attemptPlan!.compilationId},
        ${attemptPlan!.revision}, ${attemptPlan!.snapshotHash},
        ${attemptPlan!.executionSnapshotCiphertext}, now(), now(), now()
      )
    `;
    await inspection`
      INSERT INTO durable_jobs (
        id, job_type, call_attempt_id, status, generation,
        attempt_count, max_attempts, run_after, force_requested,
        lease_owner, leased_at, lease_expires_at, created_at, updated_at
      ) VALUES (
        ${jobId}, 'provider_call_reconciliation', ${attemptId}, 'running', 1,
        1, 5, now(), false,
        'privacy-test-worker', now(), now() + interval '2 minutes', now(), now()
      )
    `;
    const requestId = randomUUID();
    const deletedAt = "2026-08-22T12:00:00.000Z";

    const deletionInput = {
      callId: brief.id,
      userId: ownerA,
      requestId,
      providerRecordingDisposition: "not_present" as const,
      deletedAt
    };
    const [deletion, concurrentReplay] = await Promise.all([
      repository.deleteCallData(deletionInput),
      repository.deleteCallData(deletionInput)
    ]);
    expect(deletion).toEqual({
      callId: brief.id,
      userId: ownerA,
      requestId,
      providerRecordingDisposition: "not_present",
      deletedAt
    });
    expect(concurrentReplay).toEqual(deletion);
    await expect(repository.deleteCallData({
      callId: brief.id,
      userId: ownerA,
      requestId,
      providerRecordingDisposition: "not_present",
      deletedAt: "2026-08-22T13:00:00.000Z"
    })).resolves.toEqual(deletion);
    await expect(repository.get(brief.id)).resolves.toBeNull();
    await expect(repository.isOwnedBy(brief.id, ownerA)).resolves.toBe(false);
    await expect(repository.list({ limit: 50, userId: ownerA }))
      .resolves.not.toMatchObject({
        items: expect.arrayContaining([expect.objectContaining({ id: brief.id })])
      });

    const [stored] = await inspection<{
      recipientName: string;
      phoneNumber: string;
      objective: string;
      compilationCiphertext: string | null;
      immutableCompilationCiphertexts: number;
      approvalExecutionSnapshotCiphertexts: number;
      dataDeletedAt: Date;
      transcriptCount: number;
      feedbackCommentCiphertext: string | null;
      deletionEvents: number;
      providerCallId: string | null;
      attemptCompilationId: string | null;
      jobStatus: string;
      jobAttemptOutcome: string;
    }[]>`
      SELECT
        recipient_name AS "recipientName",
        phone_number AS "phoneNumber",
        objective,
        compilation_ciphertext AS "compilationCiphertext",
        (SELECT count(*)::int FROM call_compilations
          WHERE call_brief_id = call_briefs.id
            AND compilation_ciphertext IS NOT NULL)
          AS "immutableCompilationCiphertexts",
        (SELECT count(*)::int FROM call_compilation_approvals
          WHERE call_brief_id = call_briefs.id
            AND execution_snapshot_ciphertext IS NOT NULL)
          AS "approvalExecutionSnapshotCiphertexts",
        data_deleted_at AS "dataDeletedAt",
        (SELECT count(*)::int FROM transcript_segments
          WHERE call_brief_id = call_briefs.id) AS "transcriptCount",
        (SELECT comment_ciphertext FROM call_feedback_revisions
          WHERE call_brief_id = call_briefs.id ORDER BY revision DESC LIMIT 1)
          AS "feedbackCommentCiphertext",
        (SELECT count(*)::int FROM call_data_deletion_events
          WHERE call_brief_id = call_briefs.id) AS "deletionEvents"
        ,(SELECT provider_call_id FROM call_attempts
          WHERE id = ${attemptId}) AS "providerCallId"
        ,(SELECT compilation_id FROM call_attempts
          WHERE id = ${attemptId}) AS "attemptCompilationId"
        ,(SELECT status FROM durable_jobs
          WHERE id = ${jobId}) AS "jobStatus"
        ,(SELECT outcome FROM durable_job_attempts
          WHERE job_id = ${jobId} ORDER BY completed_at DESC LIMIT 1)
          AS "jobAttemptOutcome"
      FROM call_briefs
      WHERE id = ${brief.id}
    `;
    expect(stored).toMatchObject({
      recipientName: "Deleted call",
      phoneNumber: "",
      objective: "Deleted by owner",
      compilationCiphertext: null,
      immutableCompilationCiphertexts: 0,
      approvalExecutionSnapshotCiphertexts: 0,
      transcriptCount: 0,
      feedbackCommentCiphertext: null,
      deletionEvents: 1,
      providerCallId: null,
      attemptCompilationId: null,
      jobStatus: "cancelled",
      jobAttemptOutcome: "cancelled"
    });
    expect(stored?.dataDeletedAt.toISOString()).toBe(deletedAt);
    await expect(inspection`
      UPDATE call_feedback_revisions
      SET goal_result = 'no'
      WHERE call_brief_id = ${brief.id}
    `).rejects.toThrow("immutable");
    await expect(inspection`
      DELETE FROM call_data_deletion_events
      WHERE call_brief_id = ${brief.id}
    `).rejects.toThrow("immutable");
  });

  it("relays bounded call-change signals through PostgreSQL", async () => {
    const publisher = new PostgresCallRepository(databaseUrl!, encryptionKey);
    const sourceId = randomUUID();
    const callId = randomUUID();
    let release!: (signal: { sourceId: string; callId: string }) => void;
    const received = new Promise<{ sourceId: string; callId: string }>(
      (resolve) => { release = resolve; }
    );
    const unsubscribe = await repository.subscribeCallChanges(release);
    try {
      await publisher.publishCallChange({ sourceId, callId });
      await expect(received).resolves.toEqual({ sourceId, callId });
    } finally {
      await Promise.all([unsubscribe(), publisher.close()]);
    }
  });

  it("keeps credit reservations and settlements atomic in PostgreSQL", async () => {
    const creditOwner = randomUUID();
    const suffix = creditOwner.replaceAll("-", "");
    await inspection`
      INSERT INTO users (
        id, email, password_hash, phone_e164, phone_verified_at,
        first_name, last_name, role, status, ui_locale, created_at
      ) VALUES (
        ${creditOwner}, ${`credit-${suffix}@example.com`}, 'test-only',
        ${`+419${suffix.slice(0, 8)}`}, now(), 'Ada', 'Ledger',
        'user', 'active', 'en', now()
      )
    `;
    await repository.grantSignupCredits(creditOwner);
    await repository.grantSignupCredits(creditOwner);
    const compiler = new DeterministicBriefCompiler();
    const createReady = async (recipientName: string) => {
      const input: CreateCallBriefInput = {
        recipientName,
        phoneNumber: "+41710000008",
        objective: "Verify atomic PostgreSQL credit accounting",
        assistantProfileId: "sebastian",
        representedPersonFirstName: "Ada",
        representedPersonLastName: "Ledger",
        assistanceReason: "speech_impairment",
        locale: "en-GB",
        allowLanguageSwitch: false,
        allowedFacts: []
      };
      const brief = await repository.create(
        input,
        await compiler.compile(normalizeCreateCallBriefInput(input)),
        creditOwner
      );
      await repository.approveCompilation(brief.id);
      return brief;
    };
    const first = await createReady("Credit concurrency A");
    const second = await createReady("Credit concurrency B");

    const starts = await Promise.allSettled([
      repository.startAttempt(first.id, {
        provider: "twilio",
        userId: creditOwner,
        admissionPolicy: ledgerTestPolicy
      }),
      repository.startAttempt(second.id, {
        provider: "twilio",
        userId: creditOwner,
        admissionPolicy: ledgerTestPolicy
      })
    ]);
    const fulfilled = starts.find(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof repository.startAttempt>>> =>
        result.status === "fulfilled"
    );
    expect(fulfilled).toBeDefined();
    expect(starts.find(({ status }) => status === "rejected")).toMatchObject({
      reason: expect.objectContaining({ code: "CONCURRENT_CALL_LIMIT" })
    });
    expect((await repository.getCreditUsage(creditOwner)).balance).toBe(2);

    const providerCallId = `CA-credit-${suffix}`;
    await repository.attachProviderCall(
      fulfilled!.value.attempt.id,
      providerCallId,
      "queued"
    );
    await repository.applyProviderStatus(
      providerCallId,
      "ringing",
      "dialing",
      fulfilled!.value.attempt.callBriefId
    );
    await repository.applyProviderStatus(
      providerCallId,
      "no-answer",
      "failed",
      fulfilled!.value.attempt.callBriefId
    );
    await repository.applyProviderStatus(
      providerCallId,
      "no-answer",
      "failed",
      fulfilled!.value.attempt.callBriefId
    );
    const unansweredUsage = await repository.getCreditUsage(creditOwner);
    expect(unansweredUsage.balance).toBe(3);
    expect(unansweredUsage.transactions.filter(({ type }) => type === "call_charge"))
      .toHaveLength(0);
    expect(unansweredUsage.transactions.filter(({ type }) => type === "call_refund"))
      .toHaveLength(1);
    const unansweredEvents = await repository.listCallTelemetryEvents(
      fulfilled!.value.attempt.callBriefId
    );
    expect(
      unansweredEvents.filter(
        ({ payload }) => payload.name === "connection.confirmed"
      )
    ).toHaveLength(0);
    expect(
      unansweredEvents.filter(({ payload }) => payload.name === "credit.settled")
    ).toEqual([
      expect.objectContaining({
        payload: {
          name: "credit.settled",
          metadata: { settlement: "refund", connected: false }
        }
      })
    ]);
    expect(unansweredEvents.map(({ sequence }) => sequence)).toEqual(
      unansweredEvents.map((_, index) => index + 1)
    );
    expect(JSON.stringify(unansweredEvents)).not.toContain("+41710000008");
    expect(JSON.stringify(unansweredEvents)).not.toContain(
      "Verify atomic PostgreSQL credit accounting"
    );
    await expect(inspection`
      UPDATE call_events
      SET severity = 'warning'
      WHERE call_brief_id = ${fulfilled!.value.attempt.callBriefId}
    `).rejects.toThrow("immutable");

    const answered = await createReady("Credit successful connection");
    const answeredAttempt = await repository.startAttempt(answered.id, {
      provider: "twilio",
      userId: creditOwner,
      admissionPolicy: ledgerTestPolicy
    });
    const answeredProviderCallId = `CA-answered-${suffix}`;
    await repository.attachProviderCall(
      answeredAttempt.attempt.id,
      answeredProviderCallId,
      "queued"
    );
    await repository.applyProviderStatus(
      answeredProviderCallId,
      "in-progress",
      "in_progress",
      answered.id
    );
    await repository.applyProviderStatus(
      answeredProviderCallId,
      "in-progress",
      "in_progress",
      answered.id
    );
    await repository.applyProviderStatus(
      answeredProviderCallId,
      "completed",
      "completed",
      answered.id
    );
    const lateRinging = await repository.applyProviderStatus(
      answeredProviderCallId,
      "ringing",
      "dialing",
      answered.id
    );
    expect(lateRinging?.snapshot.brief.status).toBe("completed");
    const chargedUsage = await repository.getCreditUsage(creditOwner);
    expect(chargedUsage.balance).toBe(2);
    expect(chargedUsage.transactions.filter(({ type }) => type === "call_charge"))
      .toHaveLength(1);
    expect(chargedUsage.transactions.filter(({ type }) => type === "call_refund"))
      .toHaveLength(1);
    const answeredEvents = await repository.listCallTelemetryEvents(answered.id);
    expect(
      answeredEvents.filter(({ payload }) => payload.name === "connection.confirmed")
    ).toHaveLength(1);
    expect(
      answeredEvents.filter(({ payload }) => payload.name === "credit.settled")
    ).toEqual([
      expect.objectContaining({
        payload: {
          name: "credit.settled",
          metadata: { settlement: "charge", connected: true }
        }
      })
    ]);
    expect(
      answeredEvents.find(
        ({ payload }) =>
          payload.name === "provider.status_changed" &&
          payload.metadata.providerStatus === "ringing"
      )?.payload
    ).toEqual({
      name: "provider.status_changed",
      metadata: {
        providerStatus: "ringing",
        callStatus: "dialing",
        applied: false
      }
    });

    const preDial = await createReady("Credit pre-dial refund");
    await repository.startAttempt(preDial.id, {
      provider: "twilio",
      userId: creditOwner,
      admissionPolicy: ledgerTestPolicy
    });
    await repository.updateStatus(preDial.id, "failed");
    await repository.updateStatus(preDial.id, "failed");
    const refundedUsage = await repository.getCreditUsage(creditOwner);
    expect(refundedUsage.balance).toBe(2);
    expect(refundedUsage.transactions.filter(({ type }) => type === "call_refund"))
      .toHaveLength(2);

    await expect(inspection`
      UPDATE credit_transactions
      SET reason = 'tampered'
      WHERE user_id = ${creditOwner}
    `).rejects.toThrow("immutable");
  });

  it("serializes promo limits and keeps grants and redemptions immutable", async () => {
    const adminId = randomUUID();
    const suffix = adminId.replaceAll("-", "");
    await inspection`
      INSERT INTO users (
        id, email, password_hash, phone_e164, phone_verified_at,
        first_name, last_name, role, status, ui_locale, created_at
      ) VALUES (
        ${adminId}, ${`promo-admin-${suffix}@example.com`}, 'test-only',
        ${`+416${suffix.slice(0, 8)}`}, now(), 'Ada', 'Promo',
        'admin', 'active', 'en', now()
      )
    `;
    const codeHash = suffix.padEnd(64, "a");
    const created = await repository.createPromoCode({
      codeHash,
      credits: 6,
      globalRedemptionLimit: 1,
      perUserLimit: 1,
      startsAt: null,
      expiresAt: null,
      active: true,
      campaign: "Postgres concurrency",
      actorUserId: adminId,
      reason: "Verify atomic promo accounting",
      idempotencyKey: randomUUID(),
      now: new Date().toISOString()
    });
    expect(created).toMatchObject({
      created: true,
      promoCode: { credits: 6, globalRedemptionLimit: 1 }
    });
    expect(created.promoCode).not.toHaveProperty("codeHash");

    const requests = [ownerA, ownerB].map((userId) => ({
      codeHash,
      userId,
      idempotencyKey: randomUUID(),
      now: new Date().toISOString()
    }));
    const redemptions = await Promise.allSettled(
      requests.map((input) => repository.redeemPromo(input))
    );
    const successfulIndex = redemptions.findIndex(({ status }) => status === "fulfilled");
    expect(successfulIndex).toBeGreaterThanOrEqual(0);
    expect(redemptions.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(redemptions.find(({ status }) => status === "rejected")).toMatchObject({
      reason: expect.objectContaining({ code: "PROMO_GLOBAL_LIMIT_REACHED" })
    });
    const successfulRequest = requests[successfulIndex]!;
    await expect(repository.redeemPromo(successfulRequest)).resolves.toMatchObject({
      applied: false,
      usage: { balance: 6 }
    });

    const [ledger] = await inspection<{ redemptions: number; grants: number }[]>`
      SELECT
        (SELECT count(*)::int FROM promo_redemptions WHERE promo_code_id = ${created.promoCode.id}) AS redemptions,
        (SELECT count(*)::int FROM credit_transactions WHERE type = 'promo_grant' AND promo_redemption_id IN (
          SELECT id FROM promo_redemptions WHERE promo_code_id = ${created.promoCode.id}
        )) AS grants
    `;
    expect(ledger).toEqual({ redemptions: 1, grants: 1 });
    await expect(inspection`
      UPDATE promo_redemptions
      SET credits = credits + 1
      WHERE promo_code_id = ${created.promoCode.id}
    `).rejects.toThrow("immutable");

    const grantKey = randomUUID();
    const grantInput = {
      actorUserId: adminId,
      targetUserId: ownerA,
      credits: 2,
      reason: "Documented support adjustment",
      idempotencyKey: grantKey,
      now: new Date().toISOString()
    };
    const firstGrant = await repository.grantAdminCredits(grantInput);
    const replayedGrant = await repository.grantAdminCredits(grantInput);
    expect(firstGrant.applied).toBe(true);
    expect(replayedGrant.applied).toBe(false);
    const [storedGrant] = await inspection<{ adminId: string; reason: string }[]>`
      SELECT admin_id AS "adminId", reason
      FROM credit_transactions
      WHERE idempotency_key = ${`admin-grant:${grantKey}`}
    `;
    expect(storedGrant).toEqual({
      adminId,
      reason: "Documented support adjustment"
    });
  });

  it("enforces durable recipient suppression and the audited global kill switch", async () => {
    const safetyOwner = randomUUID();
    const suffix = safetyOwner.replaceAll("-", "");
    const userPhone = `+4178${[...suffix.slice(0, 7)]
      .map((digit) => Number.parseInt(digit, 16) % 10)
      .join("")}`;
    const phoneE164 = "+41790000021";
    await inspection`
      INSERT INTO users (
        id, email, password_hash, phone_e164, phone_verified_at,
        first_name, last_name, role, status, ui_locale, created_at
      ) VALUES (
        ${safetyOwner}, ${`safety-${suffix}@example.com`}, 'test-only',
        ${userPhone}, now(), 'Safety', 'Tester',
        'user', 'active', 'en', now()
      )
    `;
    await repository.grantSignupCredits(safetyOwner);
    const compiler = new DeterministicBriefCompiler();
    const createReady = async (recipientName: string, phoneNumber: string) => {
      const input: CreateCallBriefInput = {
        recipientName,
        phoneNumber,
        objective: "Verify durable PostgreSQL call safety controls",
        assistantProfileId: "sebastian",
        representedPersonFirstName: "Safety",
        representedPersonLastName: "Tester",
        assistanceReason: "speech_impairment",
        locale: "en-GB",
        allowLanguageSwitch: false,
        allowedFacts: []
      };
      const brief = await repository.create(
        input,
        await compiler.compile(normalizeCreateCallBriefInput(input)),
        safetyOwner
      );
      await repository.approveCompilation(brief.id);
      return brief;
    };
    const suppressedBrief = await createReady("Suppressed recipient", phoneE164);

    await repository.liftRecipientSuppression(phoneE164, {
      reason: "Integration test cleanup before suppression"
    });
    await repository.setOutboundCallsEnabled(true, {
      reason: "Integration test starts with outbound calls enabled"
    });
    await repository.suppressRecipient({
      phoneE164,
      source: "recipient_request",
      reason: "Integration test recipient opt-out",
      actorUserId: safetyOwner
    });
    await expect(repository.startAttempt(suppressedBrief.id, {
      provider: "twilio",
      userId: safetyOwner,
      admissionPolicy: ledgerTestPolicy
    })).rejects.toMatchObject({ code: "RECIPIENT_SUPPRESSED" });
    expect((await repository.getCreditUsage(safetyOwner)).balance).toBe(3);

    await repository.liftRecipientSuppression(phoneE164, {
      reason: "Integration test recipient opt-in",
      actorUserId: safetyOwner
    });
    const active = await repository.startAttempt(suppressedBrief.id, {
      provider: "twilio",
      userId: safetyOwner,
      admissionPolicy: ledgerTestPolicy
    });
    const waiting = await createReady("Waiting during emergency pause", "+41790000022");
    try {
      await repository.setOutboundCallsEnabled(false, {
        reason: "Integration test emergency pause",
        actorUserId: safetyOwner
      });
      expect((await repository.get(suppressedBrief.id))?.brief.status).toBe("dialing");
      await expect(repository.startAttempt(waiting.id, {
        provider: "twilio",
        userId: safetyOwner,
        admissionPolicy: ledgerTestPolicy
      })).rejects.toMatchObject({ code: "OUTBOUND_CALLS_DISABLED" });
      expect((await repository.getCreditUsage(safetyOwner)).balance).toBe(2);
    } finally {
      await repository.setOutboundCallsEnabled(true, {
        reason: "Integration test emergency pause cleared",
        actorUserId: safetyOwner
      });
      await repository.updateStatus(active.snapshot.brief.id, "failed");
    }
    expect((await repository.getCreditUsage(safetyOwner)).balance).toBe(3);

    const repeatPolicy = {
      ...ledgerTestPolicy,
      maxStartsPerRecipientPerDay: 2
    };
    for (const index of [0, 1, 2]) {
      const repeated = await createReady(
        `Repeated recipient ${index}`,
        "+41790000023"
      );
      if (index < 2) {
        await repository.startAttempt(repeated.id, {
          provider: "twilio",
          userId: safetyOwner,
          admissionPolicy: repeatPolicy
        });
        await repository.updateStatus(repeated.id, "failed");
      } else {
        await expect(repository.startAttempt(repeated.id, {
          provider: "twilio",
          userId: safetyOwner,
          admissionPolicy: repeatPolicy
        })).rejects.toMatchObject({ code: "RECIPIENT_REPEAT_LIMIT" });
      }
    }
    expect((await repository.getCreditUsage(safetyOwner)).balance).toBe(3);

    const suspendedReady = await createReady(
      "Suspended account call",
      "+41790000024"
    );
    await inspection`
      UPDATE users SET status = 'suspended' WHERE id = ${safetyOwner}
    `;
    try {
      await expect(repository.startAttempt(suspendedReady.id, {
        provider: "twilio",
        userId: safetyOwner,
        admissionPolicy: ledgerTestPolicy
      })).rejects.toMatchObject({ code: "CALL_NOT_FOUND" });
      await expect(createReady(
        "Suspended account new brief",
        "+41790000025"
      )).rejects.toMatchObject({ code: "CALL_NOT_FOUND" });
    } finally {
      await inspection`
        UPDATE users SET status = 'active' WHERE id = ${safetyOwner}
      `;
    }

    const eventRows = await inspection<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM safety_events
      WHERE actor_user_id = ${safetyOwner}
    `;
    expect(eventRows[0]?.count).toBeGreaterThanOrEqual(4);
    const [suppressionEvent] = await inspection<{ source: string | null }[]>`
      SELECT metadata ->> 'source' AS source
      FROM safety_events
      WHERE
        actor_user_id = ${safetyOwner}
        AND phone_e164 = ${phoneE164}
        AND event_type = 'recipient.suppressed'
      ORDER BY created_at DESC
      LIMIT 1
    `;
    expect(suppressionEvent?.source).toBe("recipient_request");
    await expect(inspection`
      UPDATE safety_events
      SET reason = 'tampered'
      WHERE actor_user_id = ${safetyOwner}
    `).rejects.toThrow("immutable");
  });

  it("persists the complete approval lifecycle and decrypts private facts", async () => {
    const input: CreateCallBriefInput = {
      recipientName: "Persistence test office",
      phoneNumber: "+41710000000",
      objective: "Verify the PostgreSQL persistence and approval lifecycle",
      assistantProfileId: "anna",
      representedPersonFirstName: "Nina",
      representedPersonLastName: "Keller",
      assistanceReason: "language_barrier",
      locale: "en-GB",
      allowLanguageSwitch: false,
      allowedFacts: ["email: private@example.com"]
    };
    const compilation = await new DeterministicBriefCompiler().compile(
      normalizeCreateCallBriefInput(input)
    );
    const brief = await repository.create(input, compilation, ownerA);
    expect(brief.status).toBe("review_required");
    const revisedInput = {
      ...input,
      objective: "Verify PostgreSQL persistence after editing the same brief"
    };
    const revisedCompilation = await new DeterministicBriefCompiler().compile(
      normalizeCreateCallBriefInput(revisedInput),
      2
    );
    const recompiled = await repository.recompile(
      brief.id,
      revisedInput,
      revisedCompilation
    );
    expect(recompiled.brief.id).toBe(brief.id);
    expect(recompiled.compilation).toMatchObject({
      revision: 2,
      approvedAt: null
    });
    await expect(repository.approveCompilation(brief.id, {
      revision: 1,
      snapshotHash: compilation.snapshotHash
    })).rejects.toMatchObject({ code: "CALL_COMPILATION_STALE" });
    const approved = await repository.approveCompilation(brief.id, {
      revision: revisedCompilation.revision,
      snapshotHash: revisedCompilation.snapshotHash
    });
    expect(approved.brief.status).toBe("ready");

    const [mutableProjection] = await inspection<{
      compilationCiphertext: string;
    }[]>`
      SELECT compilation_ciphertext AS "compilationCiphertext"
      FROM call_briefs
      WHERE id = ${brief.id}
    `;
    await inspection`
      UPDATE call_briefs
      SET compilation_ciphertext = NULL
      WHERE id = ${brief.id}
    `;
    const immutableRead = await repository.get(brief.id);
    expect(immutableRead?.compilation).toMatchObject({
      revision: revisedCompilation.revision,
      snapshotHash: revisedCompilation.snapshotHash,
      approvedAt: expect.any(String)
    });
    const started = await repository.startAttempt(brief.id, {
      provider: "mock"
    });
    await inspection`
      UPDATE call_briefs
      SET compilation_ciphertext = ${mutableProjection!.compilationCiphertext}
      WHERE id = ${brief.id}
    `;
    const compilationRows = await inspection<{
      id: string;
      revision: number;
      snapshotHash: string;
      origin: string;
      approved: boolean;
      executionSnapshotStored: boolean;
      current: boolean;
    }[]>`
      SELECT
        call_compilations.id,
        call_compilations.revision,
        call_compilations.snapshot_hash AS "snapshotHash",
        call_compilations.origin,
        call_compilation_approvals.id IS NOT NULL AS approved,
        call_compilation_approvals.execution_snapshot_ciphertext IS NOT NULL
          AS "executionSnapshotStored",
        call_briefs.current_compilation_id = call_compilations.id AS current
      FROM call_compilations
      JOIN call_briefs ON call_briefs.id = call_compilations.call_brief_id
      LEFT JOIN call_compilation_approvals
        ON call_compilation_approvals.compilation_id = call_compilations.id
      WHERE call_compilations.call_brief_id = ${brief.id}
      ORDER BY call_compilations.revision
    `;
    expect(compilationRows).toEqual([
      expect.objectContaining({
        revision: 1,
        snapshotHash: compilation.snapshotHash,
        origin: "native",
        approved: false,
        executionSnapshotStored: false,
        current: false
      }),
      expect.objectContaining({
        revision: 2,
        snapshotHash: revisedCompilation.snapshotHash,
        origin: "native",
        approved: true,
        executionSnapshotStored: true,
        current: true
      })
    ]);
    expect(started.attempt).toMatchObject({
      compilationId: compilationRows[1]!.id,
      compilationRevision: revisedCompilation.revision,
      compilationSnapshotHash: revisedCompilation.snapshotHash,
      executionSnapshot: {
        compilationRevision: revisedCompilation.revision,
        compilationSnapshotHash: revisedCompilation.snapshotHash,
        plan: { localizedObjective: revisedInput.objective }
      }
    });
    expect(await repository.getLatestAttempt(brief.id)).toEqual(
      started.attempt
    );
    await expect(inspection`
      UPDATE call_compilations
      SET snapshot_hash = ${"0".repeat(64)}
      WHERE id = ${compilationRows[1]!.id}
    `).rejects.toThrow("immutable");
    await expect(inspection`
      DELETE FROM call_compilation_approvals
      WHERE compilation_id = ${compilationRows[1]!.id}
    `).rejects.toThrow("immutable");
    const providerCallId = `mock-${brief.id}`;
    await repository.attachProviderCall(
      started.attempt.id,
      providerCallId,
      "dialing"
    );
    await repository.applyProviderStatus(
      providerCallId,
      "in-progress",
      "in_progress",
      brief.id
    );
    await repository.applyProviderStatus(
      providerCallId,
      "ringing",
      "dialing",
      brief.id
    );
    await repository.addTranscript(
      brief.id,
      "assistant",
      "Hello, I am calling on behalf of Nina Keller.",
      "en-GB"
    );
    const requested = await repository.requestApproval(brief.id, {
      category: "contact_email",
      title: "Share email",
      reason: "The recipient needs a reply address",
      proposedSpeech: "The email is private@example.com."
    });
    const resolved = await repository.resolveApproval(
      brief.id,
      requested.approval.id,
      "approved"
    );

    const [stored] = await inspection<
      {
        allowedFactsCiphertext: string;
        assistanceReasonCiphertext: string;
        compilationCiphertext: string | null;
        immutableCompilationCiphertext: string;
        representedPersonFirstName: string;
        representedPersonLastName: string;
        userId: string;
      }[]
    >`
      SELECT
        allowed_facts_ciphertext AS "allowedFactsCiphertext",
        assistance_reason_ciphertext AS "assistanceReasonCiphertext",
        compilation_ciphertext AS "compilationCiphertext",
        (
          SELECT compilation_ciphertext
          FROM call_compilations
          WHERE id = call_briefs.current_compilation_id
        ) AS "immutableCompilationCiphertext",
        represented_person_first_name AS "representedPersonFirstName",
        represented_person_last_name AS "representedPersonLastName",
        user_id AS "userId"
      FROM call_briefs
      WHERE id = ${brief.id}
    `;
    expect(stored?.allowedFactsCiphertext).not.toContain("private@example.com");
    expect(stored?.assistanceReasonCiphertext).not.toContain(
      "language_barrier"
    );
    expect(stored?.compilationCiphertext).toBeNull();
    expect(stored?.immutableCompilationCiphertext).not.toContain(
      "Verify the PostgreSQL persistence"
    );
    expect(stored?.representedPersonFirstName).toBe("Nina");
    expect(stored?.representedPersonLastName).toBe("Keller");
    expect(stored?.userId).toBe(ownerA);

    await repository.close();
    repository = new PostgresCallRepository(databaseUrl!, encryptionKey);
    const snapshot = await repository.get(brief.id);
    expect(snapshot?.brief.assistantProfileId).toBe("anna");
    expect(snapshot?.brief.voiceGender).toBe("female");
    expect(snapshot?.brief.assistanceReason).toBe("language_barrier");
    expect(snapshot?.brief.assistanceDisclosure).toContain("language barrier");
    expect(snapshot?.compilation?.approvedAt).not.toBeNull();
    expect(snapshot?.compilation?.compiledBrief?.localizedObjective).toContain(
      "PostgreSQL persistence"
    );
    expect(snapshot?.brief.allowedFacts).toEqual(["email: private@example.com"]);
    expect(snapshot?.transcript).toHaveLength(1);
    expect(snapshot?.pendingApproval).toBeNull();
    const attempt = await repository.getLatestAttempt(brief.id);
    expect(attempt?.provider).toBe("mock");
    expect(attempt?.providerCallId).toBe(providerCallId);
    expect(attempt?.status).toBe("in_progress");
    expect(attempt?.providerStatus).toBe("ringing");
    expect(resolved.approval.status).toBe("approved");
    expect(resolved.snapshot.brief.status).toBe("in_progress");

    const [auditCount] = await inspection<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM audit_events
      WHERE call_brief_id = ${brief.id}
    `;
    expect(auditCount?.count).toBeGreaterThanOrEqual(6);
    await expect(
      inspection`
        UPDATE audit_events
        SET event_type = 'tampered'
        WHERE call_brief_id = ${brief.id}
      `
    ).rejects.toThrow("immutable");
  });

  it("persists immutable owner feedback separately from technical outcomes", async () => {
    const input: CreateCallBriefInput = {
      recipientName: "Outcome persistence office",
      phoneNumber: "+41710000042",
      objective: "Verify outcome and feedback persistence",
      assistantProfileId: "sebastian",
      representedPersonFirstName: "Nina",
      representedPersonLastName: "Keller",
      assistanceReason: "speech_impairment",
      locale: "en-GB",
      allowLanguageSwitch: false,
      allowedFacts: []
    };
    const compilation = await new DeterministicBriefCompiler().compile(
      normalizeCreateCallBriefInput(input)
    );
    const brief = await repository.create(input, compilation, ownerA);
    await repository.approveCompilation(brief.id);
    const attempt = await repository.startAttempt(brief.id, {
      provider: "twilio"
    });
    const providerCallId = `CA-outcome-${brief.id}`;
    await repository.attachProviderCall(
      attempt.attempt.id,
      providerCallId,
      "queued"
    );
    await repository.applyProviderStatus(
      providerCallId,
      "no-answer",
      "failed",
      brief.id
    );
    const technical = await repository.recordSystemCallOutcome(brief.id);
    expect(technical).toMatchObject({
      technical: {
        connection: "not_confirmed",
        failureStage: "provider",
        failureCode: "no-answer"
      },
      latestOutcome: null
    });

    const idempotencyKey = randomUUID();
    const feedbackInput = {
      idempotencyKey,
      goalResult: "no" as const,
      transcriptQuality: "poor" as const,
      comment: "Private owner comment stored under encryption."
    };
    const submitted = await repository.submitOwnerCallFeedback(
      brief.id,
      ownerA,
      feedbackInput
    );
    await expect(repository.submitOwnerCallFeedback(
      brief.id,
      ownerA,
      feedbackInput
    )).resolves.toEqual(submitted);
    expect(submitted.latestOutcome).toMatchObject({
      outcome: "unresolved",
      provenance: "user",
      actorUserId: ownerA
    });
    expect(submitted.latestFeedback).toMatchObject({
      goalResult: "no",
      transcriptQuality: "poor",
      comment: feedbackInput.comment
    });
    await expect(repository.submitOwnerCallFeedback(
      brief.id,
      ownerB,
      { ...feedbackInput, idempotencyKey: randomUUID() }
    )).rejects.toMatchObject({ code: "CALL_NOT_FOUND" });

    const [stored] = await inspection<{
      commentCiphertext: string;
      feedbackRevisions: number;
      outcomeRevisions: number;
    }[]>`
      SELECT
        comment_ciphertext AS "commentCiphertext",
        (SELECT count(*)::int FROM call_feedback_revisions WHERE call_brief_id = ${brief.id}) AS "feedbackRevisions",
        (SELECT count(*)::int FROM call_outcome_revisions WHERE call_brief_id = ${brief.id}) AS "outcomeRevisions"
      FROM call_feedback_revisions
      WHERE call_brief_id = ${brief.id}
      ORDER BY revision DESC
      LIMIT 1
    `;
    expect(stored?.commentCiphertext).not.toContain(feedbackInput.comment);
    expect(stored).toMatchObject({ feedbackRevisions: 1, outcomeRevisions: 2 });
    await expect(inspection`
      UPDATE call_feedback_revisions
      SET goal_result = 'yes'
      WHERE call_brief_id = ${brief.id}
    `).rejects.toThrow("immutable");
    await expect(inspection`
      UPDATE call_outcome_revisions
      SET outcome = 'resolved'
      WHERE call_brief_id = ${brief.id}
    `).rejects.toThrow("immutable");

    const adminList = await repository.listAdminCalls({
      limit: 20,
      status: "failed",
      outcome: "unresolved",
      failureStage: "provider",
      locale: "en-GB"
    });
    expect(adminList.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: brief.id,
        ownerUserId: ownerA,
        semanticOutcome: "unresolved",
        technical: expect.objectContaining({
          connection: "not_confirmed",
          failureStage: "provider",
          failureCode: "no-answer"
        })
      })
    ]));
    expect(JSON.stringify(adminList)).not.toContain(feedbackInput.comment);
    expect(adminList.items[0]).not.toHaveProperty("phoneNumber");

    const inspector = await repository.getAdminCallInspector(brief.id);
    expect(inspector.timeline[0]).not.toHaveProperty("userId");
    expect(inspector.outcomeHistory).toHaveLength(2);
    expect(inspector.outcomeHistory.map(({ revision }) => revision)).toEqual([
      1,
      2
    ]);

    const sensitive = await repository.getAdminCallSensitiveContent(
      brief.id,
      ownerB,
      "Investigating support ticket 123"
    );
    expect(sensitive).toMatchObject({
      callBriefId: brief.id,
      phoneNumber: input.phoneNumber,
      feedbackComment: feedbackInput.comment
    });
    const [sensitiveAudit] = await inspection<{
      count: number;
      actorUserId: string;
    }[]>`
      SELECT
        count(*)::int AS count,
        min(actor_user_id::text) AS "actorUserId"
      FROM call_sensitive_access_events
      WHERE call_brief_id = ${brief.id}
    `;
    expect(sensitiveAudit).toEqual({ count: 1, actorUserId: ownerB });
    await expect(inspection`
      DELETE FROM call_sensitive_access_events
      WHERE call_brief_id = ${brief.id}
    `).rejects.toThrow("immutable");

    const metrics = await repository.getCallOutcomeMetrics();
    expect(metrics.feedbackResponses).toBeGreaterThanOrEqual(1);
    expect(metrics.goalResults.no).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(metrics)).not.toContain(feedbackInput.comment);
  });

  it("persists consent-gated recording and encrypted final transcript states", async () => {
    const input: CreateCallBriefInput = {
      recipientName: "Recording test office",
      phoneNumber: "+41710000002",
      objective: "Verify recording and post-call transcription persistence",
      assistantProfileId: "sebastian",
      representedPersonFirstName: "Nina",
      representedPersonLastName: "Keller",
      assistanceReason: "speech_impairment",
      locale: "en-GB",
      audioRetentionDays: 7,
      allowLanguageSwitch: false,
      allowedFacts: []
    };
    const compilation = await new DeterministicBriefCompiler().compile(
      normalizeCreateCallBriefInput(input)
    );
    const brief = await repository.create(input, compilation, ownerA);
    await repository.approveCompilation(brief.id);
    const attempt = await repository.startAttempt(brief.id, {
      provider: "twilio"
    });
    const providerCallId = `CA-${brief.id}`;
    const providerRecordingId = `RE-${brief.id}`;
    await repository.attachProviderCall(
      attempt.attempt.id,
      providerCallId,
      "queued"
    );

    const begun = await repository.beginRecording(brief.id, {
      method: "voice",
      decision: "affirmative",
      locale: "en-GB"
    });
    expect(begun.recording).toMatchObject({
      status: "starting",
      providerRecordingId: null
    });
    expect(
      (await repository.listCallTelemetryEvents(brief.id)).find(
        ({ payload }) => payload.name === "consent.granted"
      )?.payload
    ).toEqual({
      name: "consent.granted",
      metadata: {
        method: "voice",
        decision: "affirmative",
        locale: "en-GB"
      }
    });
    await repository.attachProviderRecording(
      begun.recording.id,
      providerRecordingId,
      "in-progress"
    );
    await repository.applyRecordingStatus({
      callBriefId: brief.id,
      recordingId: begun.recording.id,
      providerCallId,
      providerRecordingId,
      providerStatus: "completed",
      durationSeconds: 51,
      channels: 2
    });
    await repository.applyRecordingStatus({
      callBriefId: brief.id,
      recordingId: begun.recording.id,
      providerCallId,
      providerRecordingId,
      providerStatus: "in-progress"
    });
    expect((await repository.get(brief.id))?.recording?.status).toBe("available");

    const workerId = `transcription-ledger-${randomUUID()}`;
    const checkedAt = new Date().toISOString();
    const leaseExpiresAt = new Date(Date.now() + 60_000).toISOString();
    const [leasedJob] = await inspection<{ id: string; generation: number }[]>`
      UPDATE durable_jobs
      SET
        status = 'running',
        attempt_count = attempt_count + 1,
        lease_owner = ${workerId},
        leased_at = ${checkedAt}::timestamptz,
        lease_expires_at = ${leaseExpiresAt}::timestamptz,
        updated_at = ${checkedAt}::timestamptz
      WHERE job_type = 'final_transcription'
        AND recording_id = ${begun.recording.id}
        AND status = 'queued'
      RETURNING id, generation
    `;
    expect(leasedJob).toBeDefined();
    const lease = {
      jobId: leasedJob!.id,
      workerId,
      checkedAt
    };

    const claimed = await repository.claimFinalTranscript(
      begun.recording.id,
      "gpt-transcribe",
      false,
      lease
    );
    expect(claimed?.finalTranscript.status).toBe("processing");
    const transcriptionOperationId = randomUUID();
    await repository.reservePostCallTranscriptionProviderRequest({
      id: transcriptionOperationId,
      callBriefId: brief.id,
      recordingId: begun.recording.id,
      provider: "openai",
      operationType: "transcription",
      stage: "full_recording",
      requestedModel: "gpt-transcribe",
      clientRequestId: transcriptionOperationId,
      startedAt: checkedAt,
      durableJobGeneration: leasedJob!.generation
    }, lease);
    await repository.completePostCallTranscriptionProviderRequest({
      operationId: transcriptionOperationId,
      callBriefId: brief.id,
      recordingId: begun.recording.id,
      durableJobGeneration: leasedJob!.generation,
      stage: "full_recording",
      chunkKey: "full_recording",
      inputFingerprint: "a".repeat(64),
      outcome: "succeeded",
      providerRequestId: `req_${transcriptionOperationId}`,
      providerResponseId: null,
      providerModel: null,
      statusCode: 200,
      completedAt: new Date().toISOString(),
      durationMs: 250,
      errorCode: null,
      usage: {
        requestCount: 1,
        inputTextTokens: null,
        cachedInputTextTokens: null,
        cacheWriteInputTextTokens: null,
        outputTextTokens: null,
        reasoningOutputTokens: null,
        inputAudioTokens: null,
        cachedInputAudioTokens: null,
        outputAudioTokens: null,
        totalTokens: null,
        durationSeconds: 51,
        billableSeconds: null,
        rawUsage: { type: "duration", seconds: 51 }
      },
      transcriptText: "The cached private transcript."
    });
    await expect(repository.findCompletedPostCallTranscriptionChunk({
      callBriefId: brief.id,
      recordingId: begun.recording.id,
      durableJobGeneration: leasedJob!.generation,
      stage: "full_recording",
      chunkKey: "full_recording",
      inputFingerprint: "a".repeat(64),
      requestedModel: "gpt-transcribe"
    }, lease)).resolves.toBe("The cached private transcript.");
    await expect(
      repository.claimFinalTranscript(begun.recording.id, "gpt-transcribe")
    ).resolves.toBeNull();
    await repository.completeFinalTranscript(
      begun.recording.id,
      "The final private transcript.",
      [
        {
          role: "recipient",
          text: "The final private transcript.",
          startSeconds: 2.4,
          endSeconds: 4.8
        }
      ],
      lease
    );
    await expect(repository.completeDurableJob(
      leasedJob!.id,
      workerId,
      new Date().toISOString()
    )).resolves.toBe(true);

    const [stored] = await inspection<
      {
        textCiphertext: string;
        segmentsCiphertext: string;
        deleteAfter: Date | null;
      }[]
    >`
      SELECT
        final_transcripts.text_ciphertext AS "textCiphertext",
        final_transcripts.segments_ciphertext AS "segmentsCiphertext",
        call_recordings.delete_after AS "deleteAfter"
      FROM final_transcripts
      JOIN call_recordings
        ON call_recordings.id = final_transcripts.call_recording_id
      WHERE call_recordings.id = ${begun.recording.id}
    `;
    expect(stored?.textCiphertext).not.toContain("final private transcript");
    expect(stored?.segmentsCiphertext).not.toContain("final private transcript");
    expect(stored?.deleteAfter).toBeInstanceOf(Date);
    const [providerUsage] = await inspection<{
      operations: number;
      results: number;
      usageRecords: number;
      durationSeconds: number;
      chunkCiphertext: string;
    }[]>`
      SELECT
        (SELECT count(*)::int FROM provider_operations
          WHERE id = ${transcriptionOperationId}
            AND call_brief_id = ${brief.id}
            AND call_attempt_id = ${attempt.attempt.id}
            AND recording_id = ${begun.recording.id}
            AND durable_job_id = ${leasedJob!.id}) AS operations,
        (SELECT count(*)::int FROM provider_operation_results
          WHERE operation_id = ${transcriptionOperationId}) AS results,
        (SELECT count(*)::int FROM provider_usage_records
          WHERE operation_id = ${transcriptionOperationId}) AS "usageRecords",
        (SELECT duration_seconds::float FROM provider_usage_records
          WHERE operation_id = ${transcriptionOperationId}) AS "durationSeconds",
        (SELECT text_ciphertext FROM post_call_transcription_chunks
          WHERE provider_operation_id = ${transcriptionOperationId}) AS "chunkCiphertext"
    `;
    expect(providerUsage).toEqual({
      operations: 1,
      results: 1,
      usageRecords: 1,
      durationSeconds: 51,
      chunkCiphertext: expect.not.stringContaining("cached private transcript")
    });

    const snapshot = await repository.get(brief.id);
    expect(snapshot?.recording).toMatchObject({
      status: "available",
      providerRecordingId,
      durationSeconds: 51,
      channels: 2
    });
    expect(snapshot?.finalTranscript).toMatchObject({
      status: "completed",
      text: "The final private transcript.",
      segments: [
        expect.objectContaining({ role: "recipient", startSeconds: 2.4 })
      ],
      model: "gpt-transcribe"
    });

    await repository.markRecordingDeleted(brief.id);
    const deleted = await repository.get(brief.id);
    expect(deleted?.recording?.status).toBe("deleted");
    expect(deleted?.finalTranscript?.text).toBe("The final private transcript.");
    const [cacheAfterDeletion] = await inspection<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM post_call_transcription_chunks
      WHERE recording_id = ${begun.recording.id}
    `;
    expect(cacheAfterDeletion?.count).toBe(0);
  });

  it("aggregates bounded operational and system facts in PostgreSQL", async () => {
    const now = new Date();
    const input: CreateCallBriefInput = {
      recipientName: "PostgreSQL operations facts",
      phoneNumber: "+41710000062",
      objective: "Verify operational aggregation",
      assistantProfileId: "sebastian",
      representedPersonFirstName: "Nina",
      representedPersonLastName: "Keller",
      assistanceReason: "speech_impairment",
      locale: "en-GB",
      allowLanguageSwitch: false,
      allowedFacts: []
    };
    const compilation = await new DeterministicBriefCompiler().compile(
      normalizeCreateCallBriefInput(input)
    );
    const brief = await repository.create(input, compilation, ownerA);
    await repository.appendCallTelemetryEvent(brief.id, {
      idempotencyKey: "postgres-operations-first-audio",
      payload: {
        name: "conversation.first_audio",
        metadata: { latencyMs: 275 }
      }
    });

    const facts = await repository.getAdminOperationsFacts(
      new Date(now.getTime() - 60_000).toISOString(),
      new Date(now.getTime() + 60_000).toISOString()
    );
    expect(facts.createdCalls).toBeGreaterThanOrEqual(1);
    expect(facts.firstAudioLatencyMs).toMatchObject({
      samples: expect.any(Number),
      total: expect.any(Number)
    });
    expect(facts.firstAudioLatencyMs.samples).toBeGreaterThanOrEqual(1);
    expect(facts.firstAudioLatencyMs.total).toBeGreaterThanOrEqual(275);

    await repository.grantSignupCredits(ownerA);
    await repository.approveCompilation(brief.id);
    const started = await repository.startAttempt(brief.id, {
      provider: "twilio",
      userId: ownerA,
      admissionPolicy: ledgerTestPolicy
    });
    await repository.appendCallTelemetryEvent(brief.id, {
      callAttemptId: started.attempt.id,
      idempotencyKey: "postgres-pre-consent-realtime-ready",
      occurredAt: new Date(Date.now() - 12_000).toISOString(),
      payload: {
        name: "realtime.ready",
        metadata: {
          model: "gpt-realtime-test",
          transcriptionModel: "gpt-transcribe-test"
        }
      }
    });
    await repository.appendCallTelemetryEvent(brief.id, {
      callAttemptId: started.attempt.id,
      idempotencyKey: "postgres-pre-consent-stream-ended",
      payload: {
        name: "consent.failed",
        metadata: { reason: "stream_ended_before_consent" }
      }
    });
    await repository.updateStatus(brief.id, "completed");
    const preConsentFacts = await repository.getAdminOperationsFacts(
      new Date(now.getTime() - 60_000).toISOString(),
      new Date(now.getTime() + 60_000).toISOString(),
      brief.id
    );
    expect(preConsentFacts.usageSeconds.realtime).toBeGreaterThanOrEqual(11);
    expect(preConsentFacts.usageSeconds.transcription).toBe(0);
    expect(preConsentFacts.recordedDurationSeconds.samples).toBe(0);

    await inspection`DELETE FROM provider_webhook_delivery_buckets`;
    await repository.recordProviderWebhookDelivery({
      kind: "voice",
      outcome: "failed",
      receivedAt: new Date(now.getTime() - 31 * 86_400_000).toISOString(),
      errorCode: "OLD_FAILURE"
    });
    await repository.recordProviderWebhookDelivery({
      kind: "voice",
      outcome: "accepted",
      receivedAt: new Date(now.getTime() - 20_000).toISOString()
    });
    await repository.recordProviderWebhookDelivery({
      kind: "voice",
      outcome: "accepted",
      receivedAt: new Date(now.getTime() - 10_000).toISOString()
    });
    await repository.recordProviderWebhookDelivery({
      kind: "call_status",
      outcome: "failed",
      receivedAt: new Date(now.getTime() - 5_000).toISOString(),
      errorCode: "raw provider error with private text"
    });
    const freshWorkerId = randomUUID();
    await repository.reportDurableWorkerHeartbeat({
      workerId: freshWorkerId,
      startedAt: new Date(now.getTime() - 30_000).toISOString(),
      seenAt: new Date(now.getTime() - 1_000).toISOString(),
      activeJobs: 1
    });
    await repository.reportDurableWorkerHeartbeat({
      workerId: randomUUID(),
      startedAt: new Date(now.getTime() - 60_000).toISOString(),
      seenAt: new Date(now.getTime() - 20_000).toISOString(),
      activeJobs: 1
    });

    const system = await repository.getAdminSystemFacts(
      now.toISOString(),
      new Date(now.getTime() - 86_400_000).toISOString()
    );
    expect(system).toMatchObject({
      outboundCalls: {
        enabled: expect.any(Boolean),
        reason: expect.any(String)
      },
      activeCalls: expect.any(Number),
      recentWarnings: expect.any(Number),
      recentErrors: expect.any(Number),
      callPlanCutover: {
        recoverableLegacyCalls: expect.any(Number),
        archivedLegacyCalls: expect.any(Number),
        recompileRequiredCalls: expect.any(Number),
        unavailableLegacyCalls: expect.any(Number),
        executableLegacyCalls: expect.any(Number),
        historicalAttemptsWithoutCompilation: expect.any(Number),
        historicalAttemptsWithoutExecutionSnapshot: expect.any(Number),
        activeLegacyAttempts: expect.any(Number),
        activeRecompilations: expect.any(Number)
      },
      externalWorker: {
        healthyInstances: 1,
        staleInstances: 1,
        activeJobs: 1,
        lastSeenAt: expect.any(String)
      },
      webhooks: {
        voice: {
          accepted: 2,
          failed: 0,
          lastAcceptedAt: expect.any(String)
        },
        call_status: {
          failed: 1,
          lastProblemCode: "WEBHOOK_DELIVERY_FAILED"
        },
        recording_status: {
          accepted: 0,
          rejected: 0,
          unmatched: 0,
          failed: 0
        }
      }
    });
    await repository.stopDurableWorkerHeartbeat(
      freshWorkerId,
      now.toISOString()
    );
    const [storedWebhookFacts] = await inspection<{
      rows: number;
      total: number;
    }[]>`
      SELECT count(*)::int AS rows, sum(delivery_count)::int AS total
      FROM provider_webhook_delivery_buckets
    `;
    expect(storedWebhookFacts).toEqual({ rows: 2, total: 3 });
    await expect(inspection`
      UPDATE provider_webhook_delivery_buckets
      SET last_error_code = 'private provider error text'
      WHERE outcome = 'failed'
    `).rejects.toThrow("provider_webhook_delivery_error_code_check");
  });

  it("reports recoverable legacy compilations until the immutable pointer is restored", async () => {
    const input: CreateCallBriefInput = {
      recipientName: "Cutover readiness office",
      phoneNumber: "+41710000058",
      objective: "Verify the immutable compilation cutover counter",
      assistantProfileId: "sebastian",
      representedPersonFirstName: "Nina",
      representedPersonLastName: "Keller",
      assistanceReason: "speech_impairment",
      locale: "en-GB",
      allowLanguageSwitch: false,
      allowedFacts: []
    };
    const compilation = await new DeterministicBriefCompiler().compile(
      normalizeCreateCallBriefInput(input)
    );
    const brief = await repository.create(input, compilation, ownerA);
    const [stored] = await inspection<{ currentCompilationId: string }[]>`
      SELECT current_compilation_id AS "currentCompilationId"
      FROM call_briefs
      WHERE id = ${brief.id}
    `;
    expect(stored?.currentCompilationId).toBeTypeOf("string");
    const before = await repository.getAdminSystemFacts(
      new Date().toISOString(),
      new Date(Date.now() - 86_400_000).toISOString()
    );

    const approvedAt = new Date().toISOString();
    const approvedCompilation = { ...compilation, approvedAt };
    try {
      await inspection`
        UPDATE call_briefs
        SET
          current_compilation_id = NULL,
          compilation_ciphertext = ${encryptJson(
            approvedCompilation,
            encryptionKey
          )},
          status = 'completed'
        WHERE id = ${brief.id}
      `;
      const during = await repository.getAdminSystemFacts(
        new Date().toISOString(),
        new Date(Date.now() - 86_400_000).toISOString()
      );
      expect(during.callPlanCutover.recoverableLegacyCalls).toBe(
        before.callPlanCutover.recoverableLegacyCalls + 1
      );
      await expect(repository.get(brief.id)).resolves.toMatchObject({
        executionPlanSource: "unavailable",
        compilation: null
      });
      await expect(repository.approveCompilation(brief.id)).rejects
        .toMatchObject({ code: "CALL_COMPILATION_RECOMPILE_REQUIRED" });
      await expect(repository.startAttempt(brief.id, {
        provider: "mock"
      })).rejects.toMatchObject({
        code: "CALL_NOT_READY"
      });
      await expect(inspection`
        INSERT INTO call_attempts (
          id, call_brief_id, provider, status, started_at, created_at
        ) VALUES (
          ${randomUUID()}, ${brief.id}, 'mock', 'dialing', now(), now()
        )
      `).rejects.toThrow("require an immutable execution plan");
      const preview = await repository.backfillLegacyCompilationBatch(
        500,
        null,
        false
      );
      expect(preview.validCandidates).toBeGreaterThanOrEqual(1);
      expect(preview.backfilledCompilations).toBe(0);
      const [afterPreview] = await inspection<{
        currentCompilationId: string | null;
      }[]>`
        SELECT current_compilation_id AS "currentCompilationId"
        FROM call_briefs
        WHERE id = ${brief.id}
      `;
      expect(afterPreview?.currentCompilationId).toBeNull();
      const backfilled = await repository.backfillLegacyCompilationBatch(500);
      expect(backfilled.backfilledCompilations).toBeGreaterThanOrEqual(1);
      expect(backfilled.approvalSnapshotsCreated).toBeGreaterThanOrEqual(1);
      const [materialized] = await inspection<{
        currentCompilationId: string | null;
        approvalSnapshotStored: boolean;
      }[]>`
        SELECT
          call_briefs.current_compilation_id AS "currentCompilationId",
          call_compilation_approvals.execution_snapshot_ciphertext IS NOT NULL
            AS "approvalSnapshotStored"
        FROM call_briefs
        LEFT JOIN call_compilation_approvals
          ON call_compilation_approvals.compilation_id =
            call_briefs.current_compilation_id
        WHERE call_briefs.id = ${brief.id}
      `;
      expect(materialized).toEqual({
        currentCompilationId: stored!.currentCompilationId,
        approvalSnapshotStored: true
      });
    } finally {
      await inspection`
        UPDATE call_briefs
        SET current_compilation_id = ${stored!.currentCompilationId}
        WHERE id = ${brief.id}
      `;
    }

    const restored = await repository.getAdminSystemFacts(
      new Date().toISOString(),
      new Date(Date.now() - 86_400_000).toISOString()
    );
    expect(restored.callPlanCutover.recoverableLegacyCalls).toBe(
      before.callPlanCutover.recoverableLegacyCalls
    );
  });

  it("archives terminal incompatible plans and requires draft recompilation", async () => {
    const terminalInput: CreateCallBriefInput = {
      recipientName: "Archived legacy office",
      phoneNumber: "+41710000068",
      objective: "Preserve a terminal legacy call without executing it again",
      assistantProfileId: "sebastian",
      representedPersonFirstName: "Nina",
      representedPersonLastName: "Keller",
      assistanceReason: "speech_impairment",
      locale: "en-GB",
      allowLanguageSwitch: false,
      allowedFacts: []
    };
    const draftInput: CreateCallBriefInput = {
      ...terminalInput,
      recipientName: "Legacy draft office",
      phoneNumber: "+41710000069",
      objective: "Recompile this draft before it can be approved"
    };
    const compiler = new DeterministicBriefCompiler();
    const terminalCompilation = await compiler.compile(
      normalizeCreateCallBriefInput(terminalInput)
    );
    const draftCompilation = await compiler.compile(
      normalizeCreateCallBriefInput(draftInput)
    );
    const terminal = await repository.create(
      terminalInput,
      terminalCompilation,
      ownerA
    );
    const draft = await repository.create(draftInput, draftCompilation, ownerA);
    const pointers = await inspection<{
      id: string;
      currentCompilationId: string;
    }[]>`
      SELECT id, current_compilation_id AS "currentCompilationId"
      FROM call_briefs
      WHERE id IN (${terminal.id}, ${draft.id})
      ORDER BY id
    `;
    const pointerById = new Map(
      pointers.map(({ id, currentCompilationId }) => [id, currentCompilationId])
    );
    const incompatibleCiphertext = encryptJson(
      { compilerVersion: "brief-compiler-2" },
      encryptionKey
    );
    try {
      await inspection`
        UPDATE call_briefs
        SET
          current_compilation_id = NULL,
          compilation_ciphertext = ${incompatibleCiphertext},
          status = CASE
            WHEN id = ${terminal.id} THEN 'completed'
            ELSE 'review_required'
          END
        WHERE id IN (${terminal.id}, ${draft.id})
      `;
      const preview = await repository.classifyLegacyCallPlanBatch(
        500,
        null,
        false
      );
      expect(preview).toMatchObject({
        archivedTerminal: expect.any(Number),
        recompileRequired: expect.any(Number),
        unclassified: 0
      });
      expect(preview.archivedTerminal).toBeGreaterThanOrEqual(1);
      expect(preview.recompileRequired).toBeGreaterThanOrEqual(1);
      const [unchanged] = await inspection<{
        dispositions: number;
      }[]>`
        SELECT count(legacy_compilation_disposition)::int AS dispositions
        FROM call_briefs
        WHERE id IN (${terminal.id}, ${draft.id})
      `;
      expect(unchanged?.dispositions).toBe(0);

      const classified = await repository.classifyLegacyCallPlanBatch(500);
      expect(classified.archivedTerminal).toBeGreaterThanOrEqual(1);
      expect(classified.recompileRequired).toBeGreaterThanOrEqual(1);
      await expect(repository.get(terminal.id)).resolves.toMatchObject({
        executionPlanSource: "archived",
        compilation: null
      });
      await expect(repository.get(draft.id)).resolves.toMatchObject({
        executionPlanSource: "recompile_required",
        compilation: null
      });
      const [storedCiphertext] = await inspection<{
        terminalCiphertext: string;
        draftCiphertext: string;
      }[]>`
        SELECT
          max(compilation_ciphertext) FILTER (WHERE id = ${terminal.id})
            AS "terminalCiphertext",
          max(compilation_ciphertext) FILTER (WHERE id = ${draft.id})
            AS "draftCiphertext"
        FROM call_briefs
        WHERE id IN (${terminal.id}, ${draft.id})
      `;
      expect(storedCiphertext).toEqual({
        terminalCiphertext: incompatibleCiphertext,
        draftCiphertext: incompatibleCiphertext
      });

      const replacement = await compiler.compile(
        normalizeCreateCallBriefInput(draftInput),
        2
      );
      await repository.recompile(draft.id, draftInput, replacement);
      await expect(repository.get(draft.id)).resolves.toMatchObject({
        executionPlanSource: "immutable",
        compilation: { revision: 2 }
      });
    } finally {
      await inspection`
        UPDATE call_briefs
        SET
          current_compilation_id = CASE
            WHEN id = ${terminal.id}
              THEN ${pointerById.get(terminal.id)!}::uuid
            ELSE current_compilation_id
          END,
          legacy_compilation_disposition = NULL
        WHERE id IN (${terminal.id}, ${draft.id})
      `;
    }
  });

  it("persists provider reconciliation targets and fences stale writes", async () => {
    const input: CreateCallBriefInput = {
      recipientName: "PostgreSQL provider reconciliation",
      phoneNumber: "+41710000066",
      objective: "Recover provider state after a lost callback",
      assistantProfileId: "sebastian",
      representedPersonFirstName: "Nina",
      representedPersonLastName: "Keller",
      assistanceReason: "speech_impairment",
      locale: "en-GB",
      allowLanguageSwitch: false,
      allowedFacts: []
    };
    const compilation = await new DeterministicBriefCompiler().compile(
      normalizeCreateCallBriefInput(input)
    );
    const brief = await repository.create(input, compilation, ownerA);
    await repository.approveCompilation(brief.id);
    const attempt = await repository.startAttempt(brief.id, {
      provider: "twilio"
    });
    const providerCallId = `CA-reconciliation-${brief.id}`;
    await repository.attachProviderCall(
      attempt.attempt.id,
      providerCallId,
      "queued",
      "2097-01-01T00:00:00.000Z"
    );
    const begun = await repository.beginRecording(brief.id);
    const providerRecordingId = `RE-reconciliation-${brief.id}`;
    await repository.attachProviderRecording(
      begun.recording.id,
      providerRecordingId,
      "in-progress",
      "2200-01-01T00:00:00.000Z"
    );

    const jobs = await repository.listDurableJobs();
    const callJob = jobs.find(
      ({ type, callAttemptId }) =>
        type === "provider_call_reconciliation" &&
        callAttemptId === attempt.attempt.id
    );
    const recordingJob = jobs.find(
      ({ type, recordingId }) =>
        type === "provider_recording_reconciliation" &&
        recordingId === begun.recording.id
    );
    expect(callJob).toMatchObject({
      callId: brief.id,
      callAttemptId: attempt.attempt.id,
      recordingId: null,
      status: "queued"
    });
    expect(recordingJob).toMatchObject({
      callId: brief.id,
      callAttemptId: null,
      recordingId: begun.recording.id,
      status: "queued"
    });
    await inspection`
      UPDATE durable_jobs
      SET run_after = '2200-01-01T00:00:00.000Z'
      WHERE id <> ${callJob!.id}
        AND job_type = 'provider_call_reconciliation'
        AND status = 'queued'
    `;

    const first = await repository.claimDueDurableJob({
      types: ["provider_call_reconciliation"],
      workerId: "postgres-provider-a",
      now: "2097-01-01T00:00:00.000Z",
      leaseExpiresAt: "2097-01-01T00:00:01.000Z"
    });
    const second = await repository.claimDueDurableJob({
      types: ["provider_call_reconciliation"],
      workerId: "postgres-provider-b",
      now: "2097-01-01T00:00:02.000Z",
      leaseExpiresAt: "2097-01-01T00:01:02.000Z"
    });
    expect(first?.id).toBe(callJob?.id);
    expect(second).toMatchObject({
      id: callJob?.id,
      leaseOwner: "postgres-provider-b"
    });
    await expect(repository.applyProviderStatus(
      providerCallId,
      "no-answer",
      "failed",
      brief.id,
      {
        jobId: callJob!.id,
        workerId: "postgres-provider-a",
        checkedAt: "2097-01-01T00:00:02.000Z"
      }
    )).rejects.toMatchObject({ code: "DURABLE_JOB_LEASE_LOST" });
    await repository.applyProviderStatus(
      providerCallId,
      "no-answer",
      "failed",
      brief.id,
      {
        jobId: callJob!.id,
        workerId: "postgres-provider-b",
        checkedAt: "2097-01-01T00:00:02.000Z"
      }
    );
    await expect(repository.completeDurableJob(
      callJob!.id,
      "postgres-provider-b",
      "2097-01-01T00:00:03.000Z"
    )).resolves.toBe(true);
    expect((await repository.get(brief.id))?.brief.status).toBe("failed");

    await repository.seedDurableJobs("2097-01-01T00:00:03.000Z");
    expect((await repository.listDurableJobs()).find(
      ({ id }) => id === recordingJob?.id
    )).toMatchObject({
      status: "queued",
      runAfter: "2097-01-01T00:00:03.000Z"
    });
  });

  it("atomically enqueues and completes an encrypted call preparation", async () => {
    const input: CreateCallBriefInput = {
      recipientName: "Async preparation office",
      phoneNumber: "+41710000064",
      objective: "Verify durable asynchronous call brief preparation",
      assistantProfileId: "sebastian",
      representedPersonFirstName: "Nina",
      representedPersonLastName: "Keller",
      assistanceReason: "speech_impairment",
      locale: "en-GB",
      allowLanguageSwitch: false,
      allowedFacts: []
    };
    const idempotencyKey = randomUUID();
    const now = "2096-01-01T00:00:00.000Z";
    const queued = await repository.enqueueCallPreparation({
      userId: ownerA,
      idempotencyKey,
      inputFingerprint: "a".repeat(64),
      input,
      now
    });
    await expect(repository.enqueueCallPreparation({
      userId: ownerA,
      idempotencyKey,
      inputFingerprint: "a".repeat(64),
      input,
      now
    })).resolves.toMatchObject({ id: queued.id, status: "queued" });
    await expect(repository.enqueueCallPreparation({
      userId: ownerA,
      idempotencyKey,
      inputFingerprint: "b".repeat(64),
      input,
      now
    })).rejects.toMatchObject({
      code: "CALL_PREPARATION_IDEMPOTENCY_CONFLICT"
    });

    const job = await repository.claimDueDurableJob({
      types: ["brief_compilation"],
      workerId: "postgres-preparation-worker",
      now,
      leaseExpiresAt: "2096-01-01T00:01:00.000Z"
    });
    expect(job).toMatchObject({
      callPreparationId: queued.id,
      callId: null,
      attemptCount: 1
    });
    const lease = {
      jobId: job!.id,
      workerId: "postgres-preparation-worker",
      checkedAt: "2096-01-01T00:00:01.000Z"
    };
    const work = await repository.claimCallPreparation(queued.id, lease);
    expect(work.input).toEqual(normalizeCreateCallBriefInput(input));
    const reservationInputs = Array.from({ length: 12 }, () => {
      const id = randomUUID();
      return {
          id,
          preparationId: queued.id,
          provider: "openai" as const,
          operationType: "brief_compilation" as const,
          stage: "compilation" as const,
          requestedModel: "gpt-5.6",
          clientRequestId: id,
          startedAt: lease.checkedAt,
          maxRequests: 8,
          durableJobGeneration: job!.generation
      };
    });
    const reservations = await Promise.all(
      reservationInputs.map((reservation) =>
        repository.reserveCallPreparationProviderRequest(reservation, lease)
      )
    );
    expect(reservations.filter(Boolean)).toHaveLength(8);
    const acceptedOperationId = reservationInputs[
      reservations.findIndex(Boolean)
    ]!.id;
    const providerUsageKey = randomUUID();
    const operationResult = {
      operationId: acceptedOperationId,
      outcome: "succeeded" as const,
      providerRequestId: `req_postgres_usage_${providerUsageKey}`,
      providerResponseId: `resp_postgres_usage_${providerUsageKey}`,
      providerModel: "gpt-5.6-2026-08-01",
      statusCode: 200,
      completedAt: "2096-01-01T00:00:02.000Z",
      durationMs: 123,
      errorCode: null,
      usage: {
        inputTextTokens: 100,
        cachedInputTextTokens: 25,
        cacheWriteInputTextTokens: null,
        outputTextTokens: 40,
        reasoningOutputTokens: 5,
        totalTokens: 140,
        rawUsage: {
          input_tokens: 100,
          output_tokens: 40,
          total_tokens: 140
        }
      }
    };
    await repository.completeProviderOperation(operationResult);
    await repository.completeProviderOperation(operationResult);
    const compilation = await new DeterministicBriefCompiler().compile(
      normalizeCreateCallBriefInput(input)
    );
    const brief = await repository.create(
      input,
      compilation,
      ownerA,
      idempotencyKey,
      { preparationId: queued.id, lease }
    );
    await expect(repository.completeDurableJob(
      job!.id,
      "postgres-preparation-worker",
      "2096-01-01T00:00:02.000Z"
    )).resolves.toBe(true);
    await expect(repository.getCallPreparation(queued.id, ownerA))
      .resolves.toMatchObject({
        status: "succeeded",
        callBriefId: brief.id,
        attemptCount: 1
      });
    const [stored] = await inspection<{
      inputCiphertext: string | null;
      providerRequestCount: number;
    }[]>`
      SELECT
        input_ciphertext AS "inputCiphertext",
        provider_request_count AS "providerRequestCount"
      FROM call_preparation_requests
      WHERE id = ${queued.id}
    `;
    expect(stored?.inputCiphertext).toBeNull();
    expect(stored?.providerRequestCount).toBe(8);
    const [ledger] = await inspection<{
      operations: number;
      results: number;
      usageRecords: number;
      inputTextTokens: number;
    }[]>`
      SELECT
        (SELECT count(*)::int FROM provider_operations
          WHERE call_preparation_id = ${queued.id}) AS operations,
        (SELECT count(*)::int FROM provider_operation_results
          WHERE operation_id = ${acceptedOperationId}) AS results,
        (SELECT count(*)::int FROM provider_usage_records
          WHERE operation_id = ${acceptedOperationId}) AS "usageRecords",
        (SELECT input_text_tokens FROM provider_usage_records
          WHERE operation_id = ${acceptedOperationId}) AS "inputTextTokens"
    `;
    expect(ledger).toEqual({
      operations: 8,
      results: 1,
      usageRecords: 1,
      inputTextTokens: 100
    });
    const callFacts = await repository.getAdminOperationsFacts(
      "2096-01-01T00:00:00.000Z",
      "2096-01-01T00:01:00.000Z",
      brief.id
    );
    expect(callFacts.providerUsage).toMatchObject({
      operationCount: 8,
      usageRecordCount: 1,
      buckets: [expect.objectContaining({
        provider: "openai",
        operationType: "brief_compilation",
        inputTextTokens: 100,
        outputTextTokens: 40
      })]
    });
    const preparationFacts = await repository.getAdminOperationsFacts(
      "2096-01-01T00:00:00.000Z",
      "2096-01-01T00:01:00.000Z",
      undefined,
      queued.id
    );
    expect(preparationFacts).toMatchObject({
      createdCalls: 0,
      providerUsage: {
        operationCount: 8,
        usageRecordCount: 1,
        buckets: [expect.objectContaining({
          operationType: "brief_compilation",
          inputTextTokens: 100
        })]
      }
    });
    await expect(inspection`
      UPDATE provider_operations
      SET stage = 'output_moderation'
      WHERE id = ${acceptedOperationId}
    `).rejects.toThrow(/append-only/);
    await expect(inspection`
      UPDATE provider_operation_results
      SET duration_ms = 124
      WHERE operation_id = ${acceptedOperationId}
    `).rejects.toThrow(/append-only/);
    await expect(inspection`
      UPDATE provider_usage_records
      SET input_text_tokens = 101
      WHERE operation_id = ${acceptedOperationId}
    `).rejects.toThrow(/append-only/);
  });

  it("publishes a durable recompilation only against its expected immutable revision", async () => {
    const input: CreateCallBriefInput = {
      recipientName: "Durable recompilation office",
      phoneNumber: "+41710000065",
      objective: "Ask whether the original documents were received",
      assistantProfileId: "sebastian",
      representedPersonFirstName: "Nina",
      representedPersonLastName: "Keller",
      assistanceReason: "speech_impairment",
      locale: "en-GB",
      allowLanguageSwitch: false,
      allowedFacts: []
    };
    const compiler = new DeterministicBriefCompiler();
    const brief = await repository.create(
      input,
      await compiler.compile(normalizeCreateCallBriefInput(input)),
      ownerA
    );
    const approved = await repository.approveCompilation(brief.id);
    const approvedHash = approved.compilation!.snapshotHash;
    const changed = {
      ...input,
      objective: "Ask whether the updated documents were received"
    };
    const idempotencyKey = randomUUID();
    const now = "2096-02-01T00:00:00.000Z";
    const queued = await repository.enqueueCallRecompilation({
      callBriefId: brief.id,
      userId: ownerA,
      idempotencyKey,
      inputFingerprint: "c".repeat(64),
      input: changed,
      now
    });
    await expect(repository.enqueueCallRecompilation({
      callBriefId: brief.id,
      userId: ownerA,
      idempotencyKey,
      inputFingerprint: "c".repeat(64),
      input: changed,
      now
    })).resolves.toMatchObject({ id: queued.id, status: "queued" });
    await expect(repository.enqueueCallRecompilation({
      callBriefId: brief.id,
      userId: ownerA,
      idempotencyKey: randomUUID(),
      inputFingerprint: "c".repeat(64),
      input: changed,
      now
    })).rejects.toMatchObject({ code: "CALL_RECOMPILATION_IN_PROGRESS" });
    await expect(repository.startAttempt(brief.id, {
      provider: "twilio",
      userId: ownerA
    })).rejects.toMatchObject({ code: "CALL_RECOMPILATION_IN_PROGRESS" });
    await expect(repository.get(brief.id)).resolves.toMatchObject({
      brief: { status: "ready", objective: input.objective },
      compilation: {
        revision: 1,
        snapshotHash: approvedHash,
        approvedAt: expect.any(String)
      }
    });

    await inspection`
      UPDATE durable_jobs
      SET run_after = '2200-01-01T00:00:00.000Z'
      WHERE job_type = 'brief_compilation'
        AND call_preparation_id <> ${queued.id}
        AND status = 'queued'
    `;
    const job = await repository.claimDueDurableJob({
      types: ["brief_compilation"],
      workerId: "postgres-recompilation-worker",
      now,
      leaseExpiresAt: "2096-02-01T00:01:00.000Z"
    });
    expect(job).toMatchObject({
      callPreparationId: queued.id,
      callId: brief.id,
      attemptCount: 1
    });
    const lease = {
      jobId: job!.id,
      workerId: "postgres-recompilation-worker",
      checkedAt: "2096-02-01T00:00:01.000Z"
    };
    const work = await repository.claimCallPreparation(queued.id, lease);
    expect(work).toMatchObject({
      targetCallBriefId: brief.id,
      expectedCompilationId: expect.any(String),
      targetRevision: 2,
      input: normalizeCreateCallBriefInput(changed)
    });
    const compilation = await compiler.compile(
      normalizeCreateCallBriefInput(changed),
      work.targetRevision
    );
    await repository.recompile(
      brief.id,
      changed,
      compilation,
      { preparationId: queued.id, lease }
    );
    await expect(repository.completeDurableJob(
      job!.id,
      "postgres-recompilation-worker",
      "2096-02-01T00:00:02.000Z"
    )).resolves.toBe(true);
    await expect(repository.getCallPreparation(queued.id, ownerA))
      .resolves.toMatchObject({
        status: "succeeded",
        callBriefId: brief.id,
        attemptCount: 1
      });
    await expect(repository.get(brief.id)).resolves.toMatchObject({
      brief: {
        status: "review_required",
        objective: changed.objective
      },
      compilation: {
        revision: 2,
        approvedAt: null,
        rawBrief: { objective: changed.objective }
      }
    });
    const [stored] = await inspection<{
      operationKind: string;
      targetCallBriefId: string | null;
      expectedCompilationId: string | null;
      targetRevision: number;
      inputCiphertext: string | null;
    }[]>`
      SELECT
        operation_kind AS "operationKind",
        target_call_brief_id AS "targetCallBriefId",
        expected_compilation_id AS "expectedCompilationId",
        target_revision AS "targetRevision",
        input_ciphertext AS "inputCiphertext"
      FROM call_preparation_requests
      WHERE id = ${queued.id}
    `;
    expect(stored).toMatchObject({
      operationKind: "recompilation",
      targetCallBriefId: brief.id,
      expectedCompilationId: work.expectedCompilationId,
      targetRevision: 2,
      inputCiphertext: null
    });

    const staleInput = {
      ...changed,
      objective: "Ask whether a third document set was received"
    };
    const stalePreparation = await repository.enqueueCallRecompilation({
      callBriefId: brief.id,
      userId: ownerA,
      idempotencyKey: randomUUID(),
      inputFingerprint: "d".repeat(64),
      input: staleInput,
      now: "2096-03-01T00:00:00.000Z"
    });
    const interveningInput = {
      ...changed,
      objective: "Ask whether an intervening document set was received"
    };
    await repository.recompile(
      brief.id,
      interveningInput,
      await compiler.compile(
        normalizeCreateCallBriefInput(interveningInput),
        3
      )
    );
    await inspection`
      UPDATE durable_jobs
      SET run_after = '2200-01-01T00:00:00.000Z'
      WHERE job_type = 'brief_compilation'
        AND call_preparation_id <> ${stalePreparation.id}
        AND status = 'queued'
    `;
    const staleJob = await repository.claimDueDurableJob({
      types: ["brief_compilation"],
      workerId: "postgres-stale-recompilation-worker",
      now: "2096-03-01T00:00:00.000Z",
      leaseExpiresAt: "2096-03-01T00:01:00.000Z"
    });
    expect(staleJob).toMatchObject({
      callPreparationId: stalePreparation.id,
      callId: brief.id
    });
    const staleLease = {
      jobId: staleJob!.id,
      workerId: "postgres-stale-recompilation-worker",
      checkedAt: "2096-03-01T00:00:01.000Z"
    };
    const staleWork = await repository.claimCallPreparation(
      stalePreparation.id,
      staleLease
    );
    await expect(repository.recompile(
      brief.id,
      staleInput,
      await compiler.compile(
        normalizeCreateCallBriefInput(staleInput),
        staleWork.targetRevision
      ),
      { preparationId: stalePreparation.id, lease: staleLease }
    )).rejects.toMatchObject({ code: "CALL_COMPILATION_STALE" });
    await repository.failDurableJob(
      staleJob!.id,
      staleLease.workerId,
      "CALL_COMPILATION_STALE",
      "2096-03-01T00:00:02.000Z",
      "2096-03-01T00:00:03.000Z",
      false
    );
    await expect(repository.getCallPreparation(stalePreparation.id, ownerA))
      .resolves.toMatchObject({
        status: "failed",
        callBriefId: null,
        attemptCount: 1
      });
    await expect(repository.get(brief.id)).resolves.toMatchObject({
      compilation: {
        revision: 3,
        rawBrief: { objective: interveningInput.objective }
      }
    });
  });

  it("persists and deduplicates Realtime text/audio usage by provider event", async () => {
    const input: CreateCallBriefInput = {
      recipientName: "Realtime usage office",
      phoneNumber: "+41710000064",
      objective: "Verify Realtime usage ledger persistence",
      assistantProfileId: "sebastian",
      representedPersonFirstName: "Nina",
      representedPersonLastName: "Keller",
      assistanceReason: "speech_impairment",
      locale: "en-GB",
      allowLanguageSwitch: false,
      allowedFacts: []
    };
    const compilation = await new DeterministicBriefCompiler().compile(
      normalizeCreateCallBriefInput(input)
    );
    const brief = await repository.create(input, compilation, ownerA);
    await repository.approveCompilation(brief.id);
    const { attempt } = await repository.startAttempt(brief.id, {
      provider: "twilio",
      userId: ownerA,
      admissionPolicy: ledgerTestPolicy
    });
    const telephonyOperationId = randomUUID();
    await repository.startTelephonyProviderOperation({
      id: telephonyOperationId,
      callBriefId: brief.id,
      callAttemptId: attempt.id,
      provider: "twilio",
      operationType: "telephony_leg",
      stage: "outbound_call",
      requestedModel: "programmable_voice",
      clientRequestId: telephonyOperationId,
      startedAt: "2096-01-03T00:00:00.000Z"
    });
    const providerCallId = `CA-usage-${randomUUID()}`;
    await repository.attachProviderCall(
      attempt.id,
      providerCallId,
      "in-progress"
    );
    const telephonyUsage = {
      fallbackOperationId: randomUUID(),
      callBriefId: brief.id,
      callAttemptId: attempt.id,
      providerCallId,
      providerStatus: "completed",
      durationSeconds: 37,
      billableSeconds: 60,
      occurredAt: "2096-01-03T00:00:37.000Z",
      sequenceNumber: 3
    };
    await Promise.all([
      repository.recordTelephonyLegUsage(telephonyUsage),
      repository.recordTelephonyLegUsage(telephonyUsage)
    ]);
    const sessionIds = [randomUUID(), randomUUID()];
    await repository.startRealtimeProviderSessions(sessionIds.map((id, index) => ({
      id,
      callBriefId: brief.id,
      callAttemptId: attempt.id,
      provider: "openai" as const,
      operationType: "realtime_session" as const,
      stage: index === 0
        ? "conversation" as const
        : "consent_transcription" as const,
      requestedModel: "gpt-realtime-2.1",
      clientRequestId: id,
      startedAt: "2096-01-03T00:00:00.000Z"
    })));
    const operationId = randomUUID();
    const realtimeProviderResponseId = `resp_realtime_usage_${randomUUID()}`;
    const realtimeOperation = {
      id: operationId,
      parentOperationId: sessionIds[0]!,
      callBriefId: brief.id,
      callAttemptId: attempt.id,
      provider: "openai" as const,
      operationType: "realtime_response" as const,
      stage: "conversation",
      requestedModel: "gpt-realtime-2.1",
      clientRequestId: operationId,
      startedAt: "2096-01-03T00:00:01.000Z",
      result: {
        outcome: "succeeded" as const,
        providerRequestId: null,
        providerResponseId: realtimeProviderResponseId,
        providerModel: "gpt-realtime-2.1-2026-08-01",
        statusCode: null,
        completedAt: "2096-01-03T00:00:02.000Z",
        durationMs: 1_000,
        errorCode: null,
        usage: {
          requestCount: 1,
          inputTextTokens: 70,
          cachedInputTextTokens: 20,
          cacheWriteInputTextTokens: null,
          outputTextTokens: 10,
          reasoningOutputTokens: null,
          inputAudioTokens: 50,
          cachedInputAudioTokens: 5,
          outputAudioTokens: 20,
          totalTokens: 150,
          durationSeconds: null,
          billableSeconds: null,
          rawUsage: { total_tokens: 150 }
        }
      }
    };
    await Promise.all([
      repository.recordRealtimeProviderOperation(realtimeOperation),
      repository.recordRealtimeProviderOperation(realtimeOperation)
    ]);
    const [ledger] = await inspection<{
      sessions: number;
      responses: number;
      usageRecords: number;
      inputAudioTokens: number;
      cachedInputAudioTokens: number;
      outputAudioTokens: number;
      telephonyLegs: number;
      connectedSeconds: number;
      billableSeconds: number;
    }[]>`
      SELECT
        (SELECT count(*)::int FROM provider_operations
          WHERE call_attempt_id = ${attempt.id}
            AND operation_type = 'realtime_session') AS sessions,
        (SELECT count(*)::int FROM provider_operations
          WHERE call_attempt_id = ${attempt.id}
            AND operation_type = 'realtime_response') AS responses,
        (SELECT count(*)::int
          FROM provider_usage_records usage
          INNER JOIN provider_operations operation
            ON operation.id = usage.operation_id
          WHERE operation.call_attempt_id = ${attempt.id}
            AND operation.operation_type = 'realtime_response') AS "usageRecords",
        (SELECT input_audio_tokens FROM provider_usage_records
          WHERE operation_id = ${operationId}) AS "inputAudioTokens",
        (SELECT cached_input_audio_tokens FROM provider_usage_records
          WHERE operation_id = ${operationId}) AS "cachedInputAudioTokens",
        (SELECT output_audio_tokens FROM provider_usage_records
          WHERE operation_id = ${operationId}) AS "outputAudioTokens",
        (SELECT count(*)::int FROM provider_operations
          WHERE call_attempt_id = ${attempt.id}
            AND operation_type = 'telephony_leg') AS "telephonyLegs",
        (SELECT duration_seconds::float FROM provider_usage_records
          WHERE operation_id = ${telephonyOperationId}) AS "connectedSeconds",
        (SELECT billable_seconds::float FROM provider_usage_records
          WHERE operation_id = ${telephonyOperationId}) AS "billableSeconds"
    `;
    expect(ledger).toEqual({
      sessions: 2,
      responses: 1,
      usageRecords: 1,
      inputAudioTokens: 50,
      cachedInputAudioTokens: 5,
      outputAudioTokens: 20,
      telephonyLegs: 1,
      connectedSeconds: 37,
      billableSeconds: 60
    });
    const facts = await repository.getAdminOperationsFacts(
      "2096-01-03T00:00:00.000Z",
      "2096-01-03T00:01:00.000Z"
    );
    expect(facts.providerUsage.operationCount).toBeGreaterThanOrEqual(4);
    expect(facts.providerUsage.usageRecordCount).toBeGreaterThanOrEqual(2);
    const realtimeBucket = facts.providerUsage.buckets.find((bucket) =>
      bucket.provider === "openai" &&
      bucket.operationType === "realtime_response" &&
      bucket.model === "gpt-realtime-2.1-2026-08-01"
    );
    expect(realtimeBucket).toMatchObject({
      stage: "conversation",
      usageRecords: expect.any(Number)
    });
    expect(realtimeBucket!.inputTextTokens).toBeGreaterThanOrEqual(70);
    expect(realtimeBucket!.cachedInputTextTokens).toBeGreaterThanOrEqual(20);
    expect(realtimeBucket!.inputAudioTokens).toBeGreaterThanOrEqual(50);
    expect(realtimeBucket!.cachedInputAudioTokens).toBeGreaterThanOrEqual(5);
    expect(realtimeBucket!.outputAudioTokens).toBeGreaterThanOrEqual(20);
    const telephonyBucket = facts.providerUsage.buckets.find((bucket) =>
      bucket.provider === "twilio" &&
      bucket.operationType === "telephony_leg"
    );
    expect(telephonyBucket!.durationSeconds).toBeGreaterThanOrEqual(37);
    expect(telephonyBucket!.billableSeconds).toBeGreaterThanOrEqual(60);
  });

  it("persists provider-reported Twilio cost once behind a durable lease", async () => {
    const input: CreateCallBriefInput = {
      recipientName: "Provider cost office",
      phoneNumber: "+41710000068",
      objective: "Verify provider-reported cost persistence",
      assistantProfileId: "sebastian",
      representedPersonFirstName: "Nina",
      representedPersonLastName: "Keller",
      assistanceReason: "speech_impairment",
      locale: "en-GB",
      allowLanguageSwitch: false,
      allowedFacts: []
    };
    const compilation = await new DeterministicBriefCompiler().compile(
      normalizeCreateCallBriefInput(input)
    );
    const brief = await repository.create(input, compilation, ownerA);
    await repository.approveCompilation(brief.id);
    const { attempt } = await repository.startAttempt(brief.id, {
      provider: "twilio"
    });
    const operationId = randomUUID();
    await repository.startTelephonyProviderOperation({
      id: operationId,
      callBriefId: brief.id,
      callAttemptId: attempt.id,
      provider: "twilio",
      operationType: "telephony_leg",
      stage: "outbound_call",
      requestedModel: "programmable_voice",
      clientRequestId: operationId,
      startedAt: "2096-02-01T00:00:00.000Z"
    });
    const providerCallId = `CA-cost-${randomUUID()}`;
    await repository.attachProviderCall(attempt.id, providerCallId, "in-progress");
    await repository.applyProviderStatus(
      providerCallId,
      "completed",
      "completed",
      brief.id
    );
    await repository.recordTelephonyLegUsage({
      fallbackOperationId: randomUUID(),
      callBriefId: brief.id,
      callAttemptId: attempt.id,
      providerCallId,
      providerStatus: "completed",
      durationSeconds: 37,
      billableSeconds: null,
      occurredAt: "2096-02-01T00:00:00.000Z",
      sequenceNumber: null
    });
    const [costJob] = await inspection<{ id: string }[]>`
      SELECT id
      FROM durable_jobs
      WHERE job_type = 'provider_call_cost_reconciliation'
        AND call_attempt_id = ${attempt.id}
    `;
    expect(costJob).toBeDefined();
    await inspection`
      UPDATE durable_jobs
      SET run_after = '2200-01-01T00:00:00.000Z'
      WHERE job_type = 'provider_call_cost_reconciliation'
        AND id <> ${costJob!.id}
        AND status = 'queued'
    `;
    const leased = await repository.claimDueDurableJob({
      types: ["provider_call_cost_reconciliation"],
      workerId: "postgres-provider-cost-worker",
      now: "2096-02-01T00:00:01.000Z",
      leaseExpiresAt: "2096-02-01T00:01:00.000Z"
    });
    expect(leased).toMatchObject({ id: costJob!.id, callAttemptId: attempt.id });
    const costObservedAt = new Date();
    const cost = {
      id: randomUUID(),
      fallbackOperationId: randomUUID(),
      callBriefId: brief.id,
      callAttemptId: attempt.id,
      providerCallId,
      amountMicros: 13_700,
      currency: "USD",
      rawAmount: "-0.013700",
      observedAt: costObservedAt.toISOString()
    };
    const lease = {
      jobId: leased!.id,
      workerId: "postgres-provider-cost-worker",
      checkedAt: "2096-02-01T00:00:02.000Z"
    };
    await Promise.all([
      repository.recordTelephonyProviderCost(cost, lease),
      repository.recordTelephonyProviderCost({ ...cost, id: randomUUID() }, lease)
    ]);
    const [stored] = await inspection<{
      records: number;
      amountMicros: number;
      currency: string;
      rawPrice: string;
    }[]>`
      SELECT
        count(*)::int AS records,
        max(amount_micros)::int AS "amountMicros",
        max(currency) AS currency,
        max(raw_cost->>'price') AS "rawPrice"
      FROM provider_cost_records
      WHERE operation_id = ${operationId}
    `;
    expect(stored).toEqual({
      records: 1,
      amountMicros: 13_700,
      currency: "USD",
      rawPrice: "-0.013700"
    });
    const facts = await repository.getAdminOperationsFacts(
      new Date(costObservedAt.getTime() - 1_000).toISOString(),
      new Date(costObservedAt.getTime() + 1_000).toISOString(),
      brief.id
    );
    expect(facts.providerCosts).toMatchObject({
      recordCount: 1,
      buckets: [{
        provider: "twilio",
        costBasis: "provider_reported_actual",
        component: "connectivity",
        currency: "USD",
        records: 1,
        amountMicros: 13_700
      }]
    });
    await expect(inspection`
      UPDATE provider_cost_records
      SET amount_micros = 1
      WHERE operation_id = ${operationId}
    `).rejects.toThrow(/append-only/);
    await expect(repository.completeDurableJob(
      leased!.id,
      "postgres-provider-cost-worker",
      "2096-02-01T00:00:03.000Z"
    )).resolves.toBe(true);
  });

  it("atomically cancels active preparations and erases their private input", async () => {
    const input: CreateCallBriefInput = {
      recipientName: "Cancelled preparation office",
      phoneNumber: "+41710000063",
      objective: "Verify account deletion fences queued compilation",
      assistantProfileId: "sebastian",
      representedPersonFirstName: "Nina",
      representedPersonLastName: "Keller",
      assistanceReason: "speech_impairment",
      locale: "en-GB",
      allowLanguageSwitch: false,
      allowedFacts: ["Private cancellation fact"]
    };
    const queued = await repository.enqueueCallPreparation({
      userId: ownerB,
      idempotencyKey: randomUUID(),
      inputFingerprint: "c".repeat(64),
      input,
      now: "2096-01-02T00:00:00.000Z"
    });
    const job = await repository.claimDueDurableJob({
      types: ["brief_compilation"],
      workerId: "postgres-cancellation-worker",
      now: "2096-01-02T00:00:00.000Z",
      leaseExpiresAt: "2096-01-02T00:01:00.000Z"
    });
    await repository.claimCallPreparation(queued.id, {
      jobId: job!.id,
      workerId: "postgres-cancellation-worker",
      checkedAt: "2096-01-02T00:00:01.000Z"
    });
    await repository.cancelCallPreparations(
      ownerB,
      "2096-01-02T00:00:02.000Z"
    );

    await expect(repository.getCallPreparation(queued.id, ownerB))
      .resolves.toMatchObject({
        status: "cancelled",
        callBriefId: null,
        completedAt: "2096-01-02T00:00:02.000Z"
      });
    await expect(repository.listDurableJobs()).resolves.toContainEqual(
      expect.objectContaining({
        id: job!.id,
        status: "cancelled",
        lastErrorCode: "account_deletion_requested"
      })
    );
    await expect(repository.listDurableJobAttempts(job!.id)).resolves.toEqual([
      expect.objectContaining({
        outcome: "cancelled",
        errorCode: "account_deletion_requested"
      })
    ]);
    const [stored] = await inspection<{ inputCiphertext: string | null }[]>`
      SELECT input_ciphertext AS "inputCiphertext"
      FROM call_preparation_requests
      WHERE id = ${queued.id}
    `;
    expect(stored?.inputCiphertext).toBeNull();
  });

  it("leases durable jobs with retry fencing and immutable attempt history", async () => {
    const input: CreateCallBriefInput = {
      recipientName: "PostgreSQL durable job",
      phoneNumber: "+41710000065",
      objective: "Verify durable job lease transitions",
      assistantProfileId: "sebastian",
      representedPersonFirstName: "Nina",
      representedPersonLastName: "Keller",
      assistanceReason: "speech_impairment",
      locale: "en-GB",
      allowLanguageSwitch: false,
      allowedFacts: []
    };
    const compilation = await new DeterministicBriefCompiler().compile(
      normalizeCreateCallBriefInput(input)
    );
    const brief = await repository.create(input, compilation, ownerA);
    await repository.approveCompilation(brief.id);
    const attempt = await repository.startAttempt(brief.id, {
      provider: "twilio"
    });
    const providerCallId = `CA-durable-${brief.id}`;
    await repository.attachProviderCall(
      attempt.attempt.id,
      providerCallId,
      "in-progress"
    );
    const begun = await repository.beginRecording(brief.id);
    const providerRecordingId = `RE-durable-${brief.id}`;
    await repository.attachProviderRecording(
      begun.recording.id,
      providerRecordingId,
      "in-progress"
    );
    await repository.applyRecordingStatus({
      callBriefId: brief.id,
      recordingId: begun.recording.id,
      providerCallId,
      providerRecordingId,
      providerStatus: "completed",
      durationSeconds: 15,
      channels: 2
    });
    const enqueued = await repository.enqueueDurableJob({
      type: "final_transcription",
      recordingId: begun.recording.id,
      runAfter: "2000-01-01T00:00:00.000Z",
      maxAttempts: 3
    });
    await inspection`
      UPDATE durable_jobs
      SET run_after = '2200-01-01T00:00:00.000Z'
      WHERE id <> ${enqueued.id} AND status = 'queued'
    `;
    await expect(repository.enqueueDurableJob({
      type: "final_transcription",
      recordingId: begun.recording.id,
      runAfter: "2000-01-01T00:00:00.000Z",
      maxAttempts: 3
    })).resolves.toMatchObject({ id: enqueued.id, generation: 1 });

    const unrelatedRetention = await repository.enqueueDurableJob({
      type: "recording_retention",
      recordingId: begun.recording.id,
      runAfter: "2098-12-31T23:59:58.000Z",
      maxAttempts: 2
    });
    await expect(repository.claimDueDurableJob({
      types: ["recording_retention"],
      workerId: "postgres-retention-worker",
      now: "2098-12-31T23:59:58.000Z",
      leaseExpiresAt: "2098-12-31T23:59:59.000Z"
    })).resolves.toMatchObject({ id: unrelatedRetention.id });

    const first = await repository.claimDueDurableJob({
      types: ["final_transcription"],
      workerId: "postgres-worker-a",
      now: "2099-01-01T00:00:00.000Z",
      leaseExpiresAt: "2099-01-01T00:01:00.000Z"
    });
    expect(first).toMatchObject({ id: enqueued.id, attemptCount: 1 });
    expect((await repository.listDurableJobs()).find(
      ({ id }) => id === unrelatedRetention.id
    )).toMatchObject({
      status: "running",
      leaseOwner: "postgres-retention-worker"
    });
    expect(await repository.listDurableJobAttempts(unrelatedRetention.id))
      .toEqual([]);
    await expect(repository.claimDueDurableJob({
      types: ["final_transcription"],
      workerId: "postgres-worker-b",
      now: "2099-01-01T00:00:01.000Z",
      leaseExpiresAt: "2099-01-01T00:01:01.000Z"
    })).resolves.toBeNull();

    const retry = await repository.failDurableJob(
      enqueued.id,
      "postgres-worker-a",
      "provider_timeout",
      "2099-01-01T00:00:02.000Z",
      "2099-01-01T00:00:07.000Z"
    );
    expect(retry).toMatchObject({
      status: "queued",
      attemptCount: 1,
      lastErrorCode: "provider_timeout"
    });
    const second = await repository.claimDueDurableJob({
      types: ["final_transcription"],
      workerId: "postgres-worker-b",
      now: "2099-01-01T00:00:07.000Z",
      leaseExpiresAt: "2099-01-01T00:01:07.000Z"
    });
    expect(second).toMatchObject({ id: enqueued.id, attemptCount: 2 });
    await expect(repository.completeDurableJob(
      enqueued.id,
      "postgres-worker-b",
      "2099-01-01T00:00:08.000Z"
    )).resolves.toBe(true);
    const attempts = await repository.listDurableJobAttempts(enqueued.id);
    expect(attempts.map(({ outcome }) => outcome)).toEqual([
      "retry_scheduled",
      "succeeded"
    ]);
    await expect(inspection`
      UPDATE durable_job_attempts
      SET error_code = 'tampered'
      WHERE job_id = ${enqueued.id}
    `).rejects.toThrow("immutable");

    const restarted = await repository.enqueueDurableJob({
      type: "final_transcription",
      recordingId: begun.recording.id,
      runAfter: "2099-01-01T00:00:09.000Z",
      maxAttempts: 3,
      force: true,
      restartTerminal: true
    });
    expect(restarted).toMatchObject({
      id: enqueued.id,
      status: "queued",
      generation: 2,
      attemptCount: 0,
      forceRequested: true
    });
    await inspection`
      UPDATE durable_jobs
      SET
        status = 'dead_letter',
        run_after = '2099-01-01T00:00:10.000Z',
        lease_owner = NULL,
        leased_at = NULL,
        lease_expires_at = NULL,
        updated_at = '2099-01-01T00:00:10.000Z'
      WHERE id = ${enqueued.id}
    `;
    await expect(repository.retryDurableJob(
      enqueued.id,
      ownerA,
      "Provider incident has cleared",
      "2099-01-01T00:05:00.000Z"
    )).resolves.toMatchObject({
      id: enqueued.id,
      status: "queued",
      generation: 3,
      attemptCount: 0,
      forceRequested: true
    });
    const [adminEvent] = await inspection<{
      actorUserId: string;
      reason: string;
    }[]>`
      SELECT
        actor_user_id AS "actorUserId",
        reason
      FROM durable_job_admin_events
      WHERE job_id = ${enqueued.id}
    `;
    expect(adminEvent).toEqual({
      actorUserId: ownerA,
      reason: "Provider incident has cleared"
    });
    await expect(inspection`
      DELETE FROM durable_job_admin_events
      WHERE job_id = ${enqueued.id}
    `).rejects.toThrow("immutable");
  });
});
