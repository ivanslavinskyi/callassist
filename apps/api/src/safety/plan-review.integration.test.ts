import "../config/load-env";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import { normalizeCreateCallBriefInput, type CallCompilation, type PolicyReasonCode } from "@callassist/contracts";
import { isolatedTestDatabase } from "../db/isolated-test-database";
import { PostgresCallRepository } from "../storage/postgres-call-repository";
import { DeterministicBriefCompiler } from "../brief-compiler/brief-compiler";
import { createCompilationSnapshotHash } from "../brief-compiler/compilation-integrity";
import { PlanReviewService } from "./plan-review-service";
import { recordPlanReview } from "./plan-review-publication";
import { SuperadminNotifications } from "../notifications/superadmin-notifications";
import { EmailDeliveryError, MockEmailProvider } from "../auth/email-provider";
import { backfillPlanReviewCases } from "../db/backfill-plan-reviews";

const db = isolatedTestDatabase(), key = Buffer.alloc(32, 43);
let sql: postgres.Sql, calls: PostgresCallRepository, reviews: PlanReviewService, notifications: SuperadminNotifications;
let owner: string, operator: string, email: MockEmailProvider, sequence = 0;
beforeAll(async () => {
  await db.setup(); sql = postgres(db.url, { max: 6 }); calls = new PostgresCallRepository(db.url, key);
  reviews = new PlanReviewService(db.url, key);
}, 60000);
afterAll(async () => { await notifications?.close(); await reviews?.close(); await calls?.close(); await sql?.end(); await db.teardown(); });
async function user(role = "user") {
  const id = randomUUID();
  await sql`INSERT INTO users(id,email,password_hash,phone_e164,phone_verified_at,email_verified_at,first_name,last_name,role,status,ui_locale,created_at)
    VALUES(${id},${`${id}@example.test`},'test-only',${`+417300${String(++sequence).padStart(5, "0")}`},now(),now(),'QA','Example',${role},'active','en',now())`;
  return id;
}
beforeEach(async () => {
  await notifications?.close();
  await sql`TRUNCATE plan_review_cases,plan_review_audit,superadmin_notifications,superadmin_notification_audit CASCADE`;
  owner = await user(); operator = await user("superadmin"); email = new MockEmailProvider();
  notifications = new SuperadminNotifications(db.url, key, email, { siteUrl: "https://example.test" }, calls);
  const view = await notifications.getView();
  await notifications.update({ settings: { ...view.settings, enabled: true, registrations: false, calls: false,
    planReviews: true, planReviewSignalsOnly: false, recipientUserIds: [operator] }, expectedRevision: view.revision, reason: "Fixture alerts" }, operator);
});
async function compilation(reason: PolicyReasonCode = "prohibited_content", revision = 1, objective = "Ask when the office opens") {
  const input = normalizeCreateCallBriefInput({ recipientName: "Office", phoneNumber: "+41525550111", representedPersonFirstName: "QA", representedPersonLastName: "Example",
    objective, locale: "en-GB", allowedFacts: [], assistantProfileId: "sebastian" });
  const result = await new DeterministicBriefCompiler().compile(input, revision);
  result.policyDecision = { ...result.policyDecision, status: reason === "required_information_missing" ? "needs_clarification" : "blocked",
    reasonCodes: [reason], riskLevel: reason === "required_information_missing" ? "low" : "high", clarificationQuestions: reason === "required_information_missing" ? ["Which date?"] : [] };
  result.snapshotHash = createCompilationSnapshotHash(result);
  return result;
}
async function fixture(reason: PolicyReasonCode = "prohibited_content") {
  const comp = await compilation(reason), brief = await calls.create(comp.rawBrief, comp, owner);
  const [row] = await sql<{ id: string }[]>`SELECT id FROM plan_review_cases WHERE call_brief_id=${brief.id}`;
  return { comp, brief, id: row!.id };
}
const update = (expectedRevision = 1) => ({ expectedRevision, status: "in_review" as const, resolution: null, assigneeId: operator, note: "Private evidence review", reason: "Investigate returned plan" });

describe("durable plan review", () => {
  it.each([
    ["input_moderation_flagged", "policy_signal"], ["model_refusal", "policy_signal"], ["prohibited_content", "policy_signal"],
    ["required_information_missing", "clarification"], ["unsupported_task", "unsupported_task"],
    ["fact_integrity_failure", "technical_failure"], ["plan_constraint_failure", "technical_failure"]
  ] as const)("records %s once with category %s and alerts all returns", async (reason, category) => {
    const f = await fixture(reason);
    const detail = await reviews.get(f.id);
    expect(detail.item).toMatchObject({ category, planRevision: 1, status: "new", emailPending: 1, snapshotHash: f.comp.snapshotHash });
    await sql.begin(tx => recordPlanReview(tx, f.brief.id, f.comp));
    expect((await reviews.get(f.id)).deliveries).toHaveLength(1);
    await notifications.tick(); await notifications.tick();
    expect(email.adminMessages).toHaveLength(1);
    expect(email.adminMessages[0]!.content.text).toContain(`/admin/safety/plan-reviews/${f.id}`);
    expect(email.adminMessages[0]!.content.text).not.toContain(f.comp.rawBrief.objective);
    expect((await reviews.get(f.id)).item.emailAccepted).toBe(1);
  });
  it("does not index an approved/ready plan or emit an alert", async () => {
    const comp = await compilation(); comp.policyDecision = { ...comp.policyDecision, status: "ready_for_review", reasonCodes: [], riskLevel: "low" };
    comp.snapshotHash = createCompilationSnapshotHash(comp);
    const brief = await calls.create(comp.rawBrief, comp, owner);
    expect(await sql`SELECT id FROM plan_review_cases WHERE call_brief_id=${brief.id}`).toHaveLength(0);
    await notifications.tick(); expect(email.adminMessages).toHaveLength(0);
  });
  it("retains immutable evidence for earlier revisions and links subsequent returns", async () => {
    const f = await fixture("required_information_missing"), second = await compilation("prohibited_content", 2, "Ask about a different office schedule");
    await calls.recompile(f.brief.id, second.rawBrief, second);
    const items = (await reviews.list({ callId: f.brief.id, limit: 25 })).items;
    expect(items).toHaveLength(2); expect(items[0]).toMatchObject({ planRevision: 2, previousCaseId: f.id, repeats: 1 });
    const evidence = await reviews.evidence(f.id, operator, "Review the original return");
    expect(evidence.compilation.rawBrief.objective).toBe(f.comp.rawBrief.objective);
    expect(evidence.compilation.revision).toBe(1);
    expect((await reviews.get(f.id)).audit.some(a => a.action === "evidence.accessed")).toBe(true);
  });
  it("rolls case and outbox back together and supports historical backfill without email", async () => {
    const f = await fixture(); await sql`DELETE FROM superadmin_notifications`; await sql`DELETE FROM plan_review_cases WHERE id=${f.id}`;
    await expect(sql.begin(async tx => { await recordPlanReview(tx, f.brief.id, f.comp); throw new Error("fixture rollback"); })).rejects.toThrow("fixture rollback");
    expect(await sql`SELECT id FROM plan_review_cases WHERE call_brief_id=${f.brief.id}`).toHaveLength(0);
    expect(await sql`SELECT id FROM superadmin_notifications`).toHaveLength(0);
    const dry = await backfillPlanReviewCases(sql, key); expect(dry.eligible).toBeGreaterThan(0); expect(dry.inserted).toBe(0);
    const applied = await backfillPlanReviewCases(sql, key, true); expect(applied.inserted).toBeGreaterThan(0);
    const again = await backfillPlanReviewCases(sql, key, true); expect(again.inserted).toBe(0);
    expect(await sql`SELECT id FROM superadmin_notifications`).toHaveLength(0);
    const [row] = await sql`SELECT historical FROM plan_review_cases WHERE call_brief_id=${f.brief.id}`; expect(row!.historical).toBe(true);
  });
  it("filters and paginates with stable cursor, including reason and owner", async () => {
    const one = await fixture("required_information_missing"); await fixture("prohibited_content");
    const first = await reviews.list({ userId: owner, limit: 1 }); expect(first.items).toHaveLength(1); expect(first.nextCursor).toBeTruthy();
    const next = await reviews.list({ userId: owner, limit: 1, cursor: first.nextCursor! }); expect(next.items).toHaveLength(1); expect(next.items[0]!.id).not.toBe(first.items[0]!.id);
    expect((await reviews.list({ userId: owner, reason: "required_information_missing", limit: 25 })).items.map(c => c.id)).toEqual([one.id]);
    await expect(reviews.list({ cursor: "invalid", limit: 25 })).rejects.toMatchObject({ code: "PLAN_REVIEW_CURSOR_INVALID" });
  });
  it("encrypts notes, checks role, and permits exactly one concurrent revision update", async () => {
    const f = await fixture();
    await expect(reviews.evidence(f.id, owner, "Not a superadmin")).rejects.toMatchObject({ code: "PLAN_REVIEW_FORBIDDEN" });
    const result = await Promise.allSettled([reviews.update(f.id, operator, update()), reviews.update(f.id, operator, update())]);
    expect(result.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const rejected = result.find(r => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "PLAN_REVIEW_STALE" });
    const [row] = await sql`SELECT note_ciphertext FROM plan_review_cases WHERE id=${f.id}`;
    expect(String(row!.note_ciphertext)).not.toContain("Private evidence review");
    expect((await reviews.evidence(f.id, operator, "Review encrypted note")).note).toBe("Private evidence review");
  });
  it("paginates every case within one millisecond without losing PostgreSQL microseconds", async () => {
    const oldest = await fixture(), middle = await fixture(), newest = await fixture();
    for (const [id, fraction] of [[oldest.id, "123123"], [middle.id, "123456"], [newest.id, "123987"]]) {
      await sql`UPDATE plan_review_cases SET occurred_at=${`2026-10-01T12:00:00.${fraction}Z`}::text::timestamptz WHERE id=${id!}`;
    }
    const first = await reviews.list({ userId: owner, limit: 1 });
    expect(first.items[0]!.id).toBe(newest.id);
    expect(Buffer.from(first.nextCursor!, "base64url").toString()).toContain(".123987Z|");
    const second = await reviews.list({ userId: owner, limit: 1, cursor: first.nextCursor! });
    expect(second.items[0]!.id).toBe(middle.id);
    const third = await reviews.list({ userId: owner, limit: 1, cursor: second.nextCursor! });
    expect(third.items[0]!.id).toBe(oldest.id); expect(third.nextCursor).toBeNull();
    const invalidDate = Buffer.from(`2026-02-30T12:00:00.123456Z|${newest.id}`).toString("base64url");
    await expect(reviews.list({ userId: owner, limit: 1, cursor: invalidDate })).rejects.toMatchObject({ code: "PLAN_REVIEW_CURSOR_INVALID" });
  });
  it("explicit signals-only setting suppresses clarification email, retaining its case", async () => {
    const view = await notifications.getView();
    await notifications.update({ settings: { ...view.settings, planReviewSignalsOnly: true }, expectedRevision: view.revision, reason: "Signals only fixture" }, operator);
    const f = await fixture("required_information_missing");
    expect((await reviews.get(f.id)).deliveries).toHaveLength(0);
    await fixture("model_refusal"); await notifications.tick(); expect(email.adminMessages).toHaveLength(1);
  });
  it("redacts notes and queued emails on deletion and makes evidence unavailable", async () => {
    const f = await fixture(); await reviews.update(f.id, operator, update());
    await sql`UPDATE call_briefs SET data_deleted_at=now() WHERE id=${f.brief.id}`;
    expect((await sql`SELECT note_ciphertext FROM plan_review_cases WHERE id=${f.id}`)[0]!.note_ciphertext).toBeNull();
    expect((await sql`SELECT reason_ciphertext FROM plan_review_audit WHERE case_id=${f.id}`).every(r => r.reason_ciphertext === null)).toBe(true);
    await expect(reviews.evidence(f.id, operator, "Source was deleted")).rejects.toMatchObject({ code: "PLAN_REVIEW_NOT_FOUND" });
    await notifications.tick(); expect(email.adminMessages).toHaveLength(0);
    expect((await reviews.list({ userId: owner, limit: 25 })).items).toHaveLength(0);
  });
  it("cancels alerts for a demoted recipient and never reports inbox delivery", async () => {
    await fixture(); await sql`UPDATE users SET role='admin' WHERE id=${operator}`;
    await notifications.tick(); expect(email.adminMessages).toHaveLength(0);
    expect((await sql`SELECT status FROM superadmin_notifications`)[0]!.status).toBe("cancelled");
  });
  it("retries failed alerts with audited fresh generation and rejects retry of accepted email", async () => {
    const f = await fixture(), original = email.sendAdminNotification.bind(email);
    email.sendAdminNotification = async () => { throw new EmailDeliveryError(false); };
    await notifications.tick();
    const delivery = (await reviews.get(f.id)).deliveries[0]!; expect(delivery.status).toBe("failed");
    await reviews.retryEmail(f.id, delivery.id, operator, "Provider recovered; resend intentionally");
    email.sendAdminNotification = original; await notifications.tick();
    expect(email.adminMessages).toHaveLength(1); expect(email.adminMessages[0]!.idempotencyKey).toMatch(/:2$/);
    expect((await reviews.get(f.id)).audit.some(a => a.action === "email.retry_requested")).toBe(true);
    await expect(reviews.retryEmail(f.id, delivery.id, operator, "Do not duplicate accepted")).rejects.toMatchObject({ code: "PLAN_REVIEW_EMAIL_NOT_RETRYABLE" });
  });
});
