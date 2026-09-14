import "../config/load-env";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalizeCreateCallBriefInput, type ConversationCreditEvidence } from "@callassist/contracts";
import { DeterministicBriefCompiler } from "../brief-compiler/brief-compiler";
import { isolatedTestDatabase } from "../db/isolated-test-database";
import { originalPlanReview } from "../test-helpers/original-plan-review";
import { conversationCreditFixture } from "../test-helpers/conversation-credit";
import { PostgresCallRepository } from "./postgres-call-repository";

const database = isolatedTestDatabase();
let sql: postgres.Sql, repository: PostgresCallRepository, sequence = 0;
beforeAll(async () => {
  await database.setup();
  sql = postgres(database.url, { max: 3 });
  repository = new PostgresCallRepository(database.url, Buffer.alloc(32, 13));
}, 30000);
afterAll(async () => { await repository?.close(); await sql?.end(); await database.teardown(); });

async function fixture() {
  const owner = randomUUID();
  await sql`INSERT INTO users(id,email,password_hash,phone_e164,phone_verified_at,first_name,last_name,role,status,ui_locale,created_at)
    VALUES(${owner},${`${owner}@example.com`},'test-only',${`+4171000${String(++sequence).padStart(4, "0")}`},now(),'Nina','Keller','user','active','en',now())`;
  await repository.grantSignupCredits(owner);
  const input = normalizeCreateCallBriefInput({ recipientName: "Office", phoneNumber: "+41523686688",
    objective: "Ask whether my application arrived", assistantProfileId: "sebastian",
    representedPersonFirstName: "Nina", representedPersonLastName: "Keller", locale: "en-GB",
    allowLanguageSwitch: false, allowedFacts: [] });
  const brief = await repository.create(input, await new DeterministicBriefCompiler().compile(input), owner);
  await repository.approveCompilation(brief.id, await originalPlanReview(repository, brief.id));
  const { attempt } = await repository.startAttempt(brief.id, { userId: owner, provider: "twilio" });
  await repository.attachProviderCall(attempt.id, `CA-${attempt.id}`, "in-progress");
  return { owner, brief, attempt };
}

describe("persisted conversation credit qualification", () => {
  it.each(["no_consent", "no_recording", "other_call", "wrong_role", "late"])("does not charge %s evidence", async boundary => {
    const f = await fixture();
    let evidence: ConversationCreditEvidence;
    if (boundary === "no_consent" || boundary === "no_recording") {
      if (boundary === "no_recording") await repository.beginRecording(f.brief.id);
      const q = await repository.addTranscript(f.brief.id, "assistant", "Did it arrive?", "en-GB");
      const a = await repository.addTranscript(f.brief.id, "recipient", "It arrived.", "en-GB");
      evidence = { version: 1, questionSegmentId: q.segment.id, answerSegmentId: a.segment.id, category: "task_answer" };
    } else {
      evidence = await conversationCreditFixture(repository, f.brief.id);
      if (boundary === "other_call") evidence = await conversationCreditFixture(repository, (await fixture()).brief.id);
      if (boundary === "wrong_role") evidence = { ...evidence, answerSegmentId: evidence.questionSegmentId };
      if (boundary === "late") await repository.updateStatus(f.brief.id, "completed");
    }
    expect(await repository.qualifyConversationCredit(f.brief.id, f.attempt.id, evidence)).toBe(false);
    await repository.updateStatus(f.brief.id, "completed");
    const usage = await repository.getCreditUsage(f.owner);
    expect(usage.balance).toBe(3);
    expect(usage.transactions.filter(item => item.type === "call_charge")).toHaveLength(0);
  });

  it("serializes qualifying replies and terminal refunds without duplicate settlements or deadlocks", async () => {
    for (let i = 0; i < 6; i += 1) {
      const f = await fixture();
      const evidence = await conversationCreditFixture(repository, f.brief.id);
      await Promise.all([
        repository.qualifyConversationCredit(f.brief.id, f.attempt.id, evidence),
        repository.updateStatus(f.brief.id, "completed"),
        repository.qualifyConversationCredit(f.brief.id, f.attempt.id, evidence)
      ]);
      const rows = await sql`SELECT type, qualification FROM credit_transactions
        WHERE call_attempt_id=${f.attempt.id} AND type IN ('call_charge','call_refund')`;
      expect(rows).toHaveLength(1);
      if (rows[0].type === "call_charge") expect(rows[0].qualification).toEqual(evidence);
      expect((await repository.getCreditUsage(f.owner)).balance).toBe(rows[0].type === "call_charge" ? 2 : 3);
      expect(await repository.qualifyConversationCredit(f.brief.id, f.attempt.id, evidence)).toBe(false);
    }
  });
});
