import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  normalizeCreateCallBriefInput,
  type CreateCallBriefInput
} from "@callassist/contracts";
import postgres from "postgres";
import { DeterministicBriefCompiler } from "../brief-compiler/brief-compiler";
import { runMigrations } from "../db/migrate";
import { PostgresCallRepository } from "./postgres-call-repository";
import { decodeCallBriefCursor } from "./call-repository";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("PostgresCallRepository", () => {
  const encryptionKey = Buffer.alloc(32, 7);
  let repository: PostgresCallRepository;
  let inspection: postgres.Sql;
  const ownerA = randomUUID();
  const ownerB = randomUUID();

  beforeAll(async () => {
    await runMigrations(databaseUrl);
    repository = new PostgresCallRepository(databaseUrl!, encryptionKey);
    inspection = postgres(databaseUrl!, { max: 1 });
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
      repository.startAttempt(first.id, { provider: "twilio", userId: creditOwner }),
      repository.startAttempt(second.id, { provider: "twilio", userId: creditOwner })
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

    const answered = await createReady("Credit successful connection");
    const answeredAttempt = await repository.startAttempt(answered.id, {
      provider: "twilio",
      userId: creditOwner
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
    const chargedUsage = await repository.getCreditUsage(creditOwner);
    expect(chargedUsage.balance).toBe(2);
    expect(chargedUsage.transactions.filter(({ type }) => type === "call_charge"))
      .toHaveLength(1);
    expect(chargedUsage.transactions.filter(({ type }) => type === "call_refund"))
      .toHaveLength(1);

    const preDial = await createReady("Credit pre-dial refund");
    await repository.startAttempt(preDial.id, {
      provider: "twilio",
      userId: creditOwner
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
    const approved = await repository.approveCompilation(brief.id);
    expect(approved.brief.status).toBe("ready");

    const started = await repository.startAttempt(brief.id, {
      provider: "mock"
    });
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
        compilationCiphertext: string;
        representedPersonFirstName: string;
        representedPersonLastName: string;
        userId: string;
      }[]
    >`
      SELECT
        allowed_facts_ciphertext AS "allowedFactsCiphertext",
        assistance_reason_ciphertext AS "assistanceReasonCiphertext",
        compilation_ciphertext AS "compilationCiphertext",
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
    expect(stored?.compilationCiphertext).not.toContain(
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

    const begun = await repository.beginRecording(brief.id);
    expect(begun.recording).toMatchObject({
      status: "starting",
      providerRecordingId: null
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

    const claimed = await repository.claimFinalTranscript(
      begun.recording.id,
      "gpt-transcribe"
    );
    expect(claimed?.finalTranscript.status).toBe("processing");
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
      ]
    );

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
  });
});
