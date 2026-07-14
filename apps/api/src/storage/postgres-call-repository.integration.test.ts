import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { runMigrations } from "../db/migrate";
import { PostgresCallRepository } from "./postgres-call-repository";

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

  it("persists the complete approval lifecycle and decrypts private facts", async () => {
    const brief = await repository.create({
      recipientName: "Persistence test office",
      phoneNumber: "+41710000000",
      objective: "Verify the PostgreSQL persistence and approval lifecycle",
      locale: "en-GB",
      allowLanguageSwitch: false,
      allowedFacts: ["email: private@example.com"]
    });

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
      { allowedFactsCiphertext: string }[]
    >`
      SELECT allowed_facts_ciphertext AS "allowedFactsCiphertext"
      FROM call_briefs
      WHERE id = ${brief.id}
    `;
    expect(stored?.allowedFactsCiphertext).not.toContain("private@example.com");

    await repository.close();
    repository = new PostgresCallRepository(databaseUrl!, encryptionKey);
    const snapshot = await repository.get(brief.id);
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
});
