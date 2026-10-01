import "../config/load-env";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { betaSettingsUpdateSchema, defaultBetaSettings, normalizeCreateCallBriefInput, type BetaCreditPolicy } from "@callassist/contracts";
import { isolatedTestDatabase } from "../db/isolated-test-database";
import { PostgresAuthRepository } from "../auth/postgres-auth-repository";
import { PostgresCallRepository } from "../storage/postgres-call-repository";
import { PostgresBetaControls } from "../beta/beta-controls";
import { DeterministicBriefCompiler } from "../brief-compiler/brief-compiler";
import { originalPlanReview } from "../test-helpers/original-plan-review";
import { InMemoryCallRepository } from "../storage/in-memory-call-repository";

const db = isolatedTestDatabase();
let sql: postgres.Sql, auth: PostgresAuthRepository, calls: PostgresCallRepository, controls: PostgresBetaControls, admin: string;
let sequence = 0;
const profile = () => ({ email: `${randomUUID()}@example.com`, passwordHash: "synthetic-only", phoneE164: `+41791${String(++sequence).padStart(6,"0")}`,
  firstName: "Credit", lastName: "Tester", uiLocale: "en" as const });
beforeAll(async () => {
  await db.setup(); sql = postgres(db.url, { max: 6 }); auth = new PostgresAuthRepository(db.url, true);
  calls = new PostgresCallRepository(db.url, Buffer.alloc(32, 9)); controls = new PostgresBetaControls(sql);
  const seed = new PostgresAuthRepository(db.url); const owner = await seed.createUser(profile()); await seed.close(); admin = owner.id;
  await sql`UPDATE users SET role='superadmin',phone_verified_at=now(),email_verified_at=now() WHERE id=${admin}`;
}, 30000);
afterAll(async () => { await calls?.close(); await auth?.close(); await sql?.end(); await db.teardown(); });
afterEach(() => vi.useRealTimers());
beforeEach(async () => {
  await sql`UPDATE users SET status='suspended' WHERE role='user'`;
  let view = await controls.getView();
  await controls.update({ ...defaultBetaSettings, publicAccountLimit: 1000 }, view.revision, admin, "Synthetic beta settings");
  await policy({ amount: 3, period: "lifetime" });
});
async function policy(value: BetaCreditPolicy) {
  const view = await controls.getView(); await controls.updateCreditPolicy(value, view.revision, admin, "Synthetic credit policy");
}
async function user(verified = true) {
  const owner = await auth.createUser(profile());
  if (verified) { await sql`UPDATE users SET phone_verified_at=now(),email_verified_at=now() WHERE id=${owner.id}`; await calls.grantSignupCredits(owner.id); }
  return owner.id;
}
async function ready(repository: PostgresCallRepository | InMemoryCallRepository, owner: string) {
  const input = normalizeCreateCallBriefInput({ recipientName: "Office", phoneNumber: `+41781${String(++sequence).padStart(6,"0")}`,
    objective: "Ask whether the application arrived", assistantProfileId: "sebastian", representedPersonFirstName: "Nina", representedPersonLastName: "Keller", locale: "en-GB", allowLanguageSwitch: false, allowedFacts: [] });
  const brief = await repository.create(input, await new DeterministicBriefCompiler().compile(input), owner);
  await repository.approveCompilation(brief.id, await originalPlanReview(repository, brief.id)); return brief;
}
async function applyPreview() {
  const preview = await controls.previewCreditTransition();
  const input = { expectedRevision: preview.revision, policyId: preview.policyId, previewToken: preview.previewToken, reason: "Reviewed synthetic cohort" };
  return { preview, input, result: await controls.applyCreditTransition(input, admin) };
}
describe("beta credit funding", () => {
  it("snapshots registration policy before verification and grants it once across concurrent login recovery", async () => {
    const owner = await user(false); await policy({ amount: 7, period: "lifetime" });
    await sql`UPDATE users SET phone_verified_at=now() WHERE id=${owner}`;
    await Promise.all(Array.from({ length: 5 }, () => calls.grantSignupCredits(owner)));
    expect(await calls.getCreditUsage(owner)).toMatchObject({ balance: 3, funding: { persistent: 3 } });
    expect((await calls.getCreditUsage(owner)).transactions.filter(t => t.type === "signup_grant")).toHaveLength(1);
    expect((await calls.getCreditUsage(await user())).balance).toBe(7);
  });
  it("supports zero allowance without disabling separately granted credits", async () => {
    await policy({ amount: 0, period: "day" }); const owner = await user();
    expect((await calls.getCreditUsage(owner)).balance).toBe(0);
    await calls.grantAdminCredits({ actorUserId: admin, targetUserId: owner, credits: 4, reason: "Synthetic manual credit", idempotencyKey: randomUUID(), now: new Date().toISOString() });
    expect(await calls.getCreditUsage(owner)).toMatchObject({ balance: 4, funding: { persistent: 4, allowance: { available: 0 } } });
  });
  it("does not accumulate skipped periods and returns a late refund to the expired source", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2030-02-01T23:59:00Z"));
    await policy({ amount: 2, period: "day" }); const owner = await user(), brief = await ready(calls, owner);
    const { attempt } = await calls.startAttempt(brief.id, { userId: owner, provider: "twilio" });
    expect(await calls.getCreditUsage(owner)).toMatchObject({ balance: 1, funding: { allowance: { reserved: 1 } } });
    vi.setSystemTime(new Date("2030-02-04T00:01:00Z"));
    expect((await calls.getCreditUsage(owner)).balance).toBe(2);
    await calls.attachProviderCall(attempt.id, `CA-${attempt.id}`, "busy");
    await calls.applyProviderStatus(`CA-${attempt.id}`, "busy", "failed", brief.id);
    await calls.applyProviderStatus(`CA-${attempt.id}`, "busy", "failed", brief.id);
    const usage = await calls.getCreditUsage(owner);
    expect(usage).toMatchObject({ balance: 2, funding: { persistent: 0, allowance: { available: 2 } } });
    expect(usage.transactions.filter(t => t.type === "beta_grant")).toHaveLength(2);
    const reserve = usage.transactions.find(t => t.type === "call_reservation")!, refund = usage.transactions.find(t => t.type === "call_refund")!;
    expect(refund.betaPeriodId).toBe(reserve.betaPeriodId); expect(refund.expiresAt).toBe("2030-02-02T00:00:00.000Z");
    expect(usage.transactions.filter(t => t.type === "call_refund")).toHaveLength(1);
  });
  it("serializes the last allowance unit across independent repository connections", async () => {
    await policy({ amount: 1, period: "week" }); const owner = await user();
    const a = await ready(calls, owner), b = await ready(calls, owner);
    const other = new PostgresCallRepository(db.url, Buffer.alloc(32, 9));
    try {
      const results = await Promise.allSettled([calls.startAttempt(a.id, { userId: owner, provider: "twilio" }), other.startAttempt(b.id, { userId: owner, provider: "twilio" })]);
      expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
      expect((await calls.getCreditUsage(owner)).balance).toBe(0);
      expect((await calls.getCreditUsage(owner)).transactions.filter(t => t.type === "call_reservation")).toHaveLength(1);
    } finally { await other.close(); }
  });
  it("preserves legacy balance, previews explicit transitions and applies recurring changes only at a boundary", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2030-03-01T12:00:00Z"));
    const owner = await user(); await policy({ amount: 5, period: "day" });
    expect((await calls.getCreditUsage(owner)).balance).toBe(3);
    const first = await applyPreview(); expect(first.preview).toMatchObject({ accounts: 1, immediate: 1, persistentCredits: 3 });
    expect((await calls.getCreditUsage(owner)).balance).toBe(8);
    await expect(controls.applyCreditTransition(first.input, admin)).rejects.toMatchObject({ code: "BETA_SETTINGS_STALE" });
    expect((await controls.previewCreditTransition()).accounts).toBe(0);
    await policy({ amount: 9, period: "month" }); const second = await applyPreview();
    expect(second.preview).toMatchObject({ accounts: 1, atNextBoundary: 1 });
    expect(await calls.getCreditUsage(owner)).toMatchObject({ balance: 8, funding: { allowance: { pending: { effectiveAt: "2030-03-02T00:00:00.000Z" } } } });
    vi.setSystemTime(new Date("2030-03-02T00:00:00Z"));
    expect(await calls.getCreditUsage(owner)).toMatchObject({ balance: 12, funding: { persistent: 3, allowance: { period: "month", available: 9 } } });
    await policy({ amount: 100, period: "lifetime" }); await applyPreview();
    vi.setSystemTime(new Date("2030-04-01T00:00:00Z")); await calls.grantSignupCredits(owner);
    expect((await calls.getCreditUsage(owner)).balance).toBe(3);
  });
  it("omits hidden counters and keeps public cap admission authoritative with invitation exceptions", async () => {
    let view = await controls.getView(); await controls.update({ ...view.settings, publicAccountLimit: view.publicAccounts + 1 }, view.revision, admin, "One synthetic public place");
    expect(await controls.getPublicRegistration()).toMatchObject({ state: "open", remaining: 1 });
    const attempts = await Promise.allSettled([auth.createUser(profile()), auth.createUser(profile())]);
    expect(attempts.filter(r => r.status === "fulfilled")).toHaveLength(1);
    view = await controls.getView(); await controls.update({ ...view.settings, showRegistrationRemaining: false }, view.revision, admin, "Hide public capacity");
    const access = await controls.getPublicRegistration();
    expect(access).toEqual({ state: "full", remaining: null, allowance: { amount: 3, period: "lifetime" }, timeZone: "UTC" });
    const invitation = await controls.createInvitation(admin, "Synthetic additional place");
    await expect(auth.createUser({ ...profile(), invitationCode: invitation.code })).resolves.toBeDefined();
  });
  it("requires a fresh preview when a UTC boundary changes the effective date", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2030-06-02T23:59:59Z"));
    await policy({ amount: 2, period: "day" }); const owner = await user();
    await policy({ amount: 5, period: "week" });
    const preview = await controls.previewCreditTransition();
    vi.setSystemTime(new Date("2030-06-03T00:00:00Z"));
    await expect(controls.applyCreditTransition({ expectedRevision: preview.revision, policyId: preview.policyId,
      previewToken: preview.previewToken, reason: "Apply after UTC rollover" }, admin)).rejects.toMatchObject({ code: "BETA_SETTINGS_STALE" });
    expect((await calls.getCreditUsage(owner)).funding?.allowance).toMatchObject({ period: "day", available: 2, pending: null });
    await applyPreview();
    expect((await calls.getCreditUsage(owner)).funding?.allowance?.pending).toMatchObject({ effectiveAt: "2030-06-04T00:00:00.000Z" });
    vi.setSystemTime(new Date("2030-06-04T00:00:00Z"));
    expect((await calls.getCreditUsage(owner)).funding?.allowance).toMatchObject({ period: "week", available: 5,
      startsAt: "2030-06-03T00:00:00.000Z", endsAt: "2030-06-10T00:00:00.000Z" });
  });
  it("preserves hidden registration visibility for legacy updates and applies explicit visibility changes", async () => {
    let view = await controls.getView();
    await controls.update({ ...view.settings, showRegistrationRemaining: false }, view.revision, admin, "Hide public capacity");
    view = await controls.getView();
    const { showRegistrationRemaining: _visibility, ...legacySettings } = view.settings;
    const parsed = betaSettingsUpdateSchema.parse({ settings: { ...legacySettings, maxStartsPerHour: 12 }, expectedRevision: view.revision, reason: "Legacy client budget edit" });
    expect(parsed.settings.showRegistrationRemaining).toBeUndefined();
    await controls.update(parsed.settings, parsed.expectedRevision, admin, parsed.reason);
    expect(await controls.getPublicRegistration()).toMatchObject({ remaining: null });
    expect((await controls.getView()).settings).toMatchObject({ showRegistrationRemaining: false, maxStartsPerHour: 12 });
    for (const visible of [true, false]) {
      view = await controls.getView();
      await controls.update({ ...view.settings, showRegistrationRemaining: visible }, view.revision, admin, "Explicit capacity visibility");
      expect((await controls.getView()).settings.showRegistrationRemaining).toBe(visible);
      expect((await controls.getPublicRegistration()).remaining === null).toBe(!visible);
    }
  });
  it("retains the same expired refund semantics in the memory repository", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2030-05-01T23:59:00Z"));
    const repository = new InMemoryCallRepository(), owner = randomUUID(); repository.enrollBetaCredits(owner, { amount: 1, period: "day" });
    await repository.grantSignupCredits(owner); const brief = await ready(repository, owner);
    const { attempt } = await repository.startAttempt(brief.id, { userId: owner, provider: "twilio" });
    vi.setSystemTime(new Date("2030-05-02T00:01:00Z"));
    await repository.attachProviderCall(attempt.id, `CA-${attempt.id}`, "busy");
    await repository.applyProviderStatus(`CA-${attempt.id}`, "busy", "failed", brief.id);
    const usage = await repository.getCreditUsage(owner);
    expect(usage.balance).toBe(1);
    expect(usage.transactions.find(t => t.type === "call_refund")?.betaPeriodId).toBe(usage.transactions.find(t => t.type === "call_reservation")?.betaPeriodId);
  });
});
