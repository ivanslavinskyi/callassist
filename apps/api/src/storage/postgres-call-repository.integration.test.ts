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
      recentErrors: expect.any(Number)
    });
  });
});
