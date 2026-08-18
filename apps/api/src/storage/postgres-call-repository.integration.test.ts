import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

  beforeAll(async () => {
    await runMigrations(databaseUrl);
    repository = new PostgresCallRepository(databaseUrl!, encryptionKey);
    inspection = postgres(databaseUrl!, { max: 1 });
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
        assistanceReason: "speech_impairment",
        locale: "en-GB",
        allowLanguageSwitch: false,
        allowedFacts: []
      };
      await repository.create(input, await compiler.compile(normalizeCreateCallBriefInput(input)));
    }

    const first = await repository.list({ limit: 1, search: "Cursor test" });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBeTypeOf("string");
    const cursor = decodeCallBriefCursor(first.nextCursor!);
    expect(cursor).not.toBeNull();
    const second = await repository.list({
      limit: 1,
      search: "Cursor test",
      status: "review_required",
      cursor: cursor!
    });
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
  });

  it("persists the complete approval lifecycle and decrypts private facts", async () => {
    const input: CreateCallBriefInput = {
      recipientName: "Persistence test office",
      phoneNumber: "+41710000000",
      objective: "Verify the PostgreSQL persistence and approval lifecycle",
      assistantProfileId: "anna",
      assistanceReason: "language_barrier",
      locale: "en-GB",
      allowLanguageSwitch: false,
      allowedFacts: ["email: private@example.com"]
    };
    const compilation = await new DeterministicBriefCompiler().compile(
      normalizeCreateCallBriefInput(input)
    );
    const brief = await repository.create(input, compilation);
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
      "Hello, I am calling on behalf of Ivan.",
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
      }[]
    >`
      SELECT
        allowed_facts_ciphertext AS "allowedFactsCiphertext",
        assistance_reason_ciphertext AS "assistanceReasonCiphertext",
        compilation_ciphertext AS "compilationCiphertext"
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
      assistanceReason: "speech_impairment",
      locale: "en-GB",
      audioRetentionDays: 7,
      allowLanguageSwitch: false,
      allowedFacts: []
    };
    const compilation = await new DeterministicBriefCompiler().compile(
      normalizeCreateCallBriefInput(input)
    );
    const brief = await repository.create(input, compilation);
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
