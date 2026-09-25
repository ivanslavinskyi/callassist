import "../config/load-env";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterEach, expect, it, vi } from "vitest";
import { betaControlsViewSchema, defaultBetaSettings, type BetaSettings } from "@callassist/contracts";
import { isolatedTestDatabase } from "../db/isolated-test-database";
import { PostgresAuthRepository } from "../auth/postgres-auth-repository";
import { PostgresCallRepository } from "../storage/postgres-call-repository";
import { PostgresBetaControls } from "./beta-controls";
import { AuthService } from "../auth/auth-service";
import { hashPassword } from "../auth/password";
import { MockVerificationProvider } from "../auth/verification-provider";
import { CallService } from "../call-service";
import { buildApp } from "../app";
import { originalPlanReview } from "../test-helpers/original-plan-review";
import { TwilioVerificationProvider } from "../auth/twilio-verification-provider";
import { ResendEmailProvider } from "../auth/resend-email-provider";

const closers: Array<() => Promise<unknown>> = [];
it("revision-checks registration policies, rejects non-superadmins and preserves them for old beta clients", async () => {
  const f = await fixture();
  const view = await f.controls.getView();
  const policy = { onboarding: "registration", emailVerification: "deferrable" } as const;
  const owner = await f.owner();
  await expect(f.controls.updateRegistration(policy, view.revision, owner.id, "Not authorized"))
    .rejects.toMatchObject({ code: "BETA_ADMIN_FORBIDDEN" });
  await f.controls.updateRegistration(policy, view.revision, f.admin.id, "Registration simplification");
  await expect(f.controls.updateRegistration(policy, view.revision, f.admin.id, "Stale revision"))
    .rejects.toMatchObject({ code: "BETA_SETTINGS_STALE" });
  await f.controls.update(f.settings, (await f.controls.getView()).revision, f.admin.id, "Old settings client");
  expect(await f.controls.getRegistrationPolicy()).toEqual(policy);
  expect(await f.sql`SELECT action FROM beta_control_audit WHERE reason='Registration simplification'`).toHaveLength(1);
}, 30_000);

it("enforces the current email policy before reserving credits or starting an attempt", async () => {
  const f = await fixture();
  const owner = await f.owner();
  const call = await f.ready(owner.id);
  await f.sql`UPDATE users SET email_verified_at=NULL, email_verification_deferred_at=now() WHERE id=${owner.id}`;
  const before = await f.repository.getCreditUsage(owner.id);
  await expect(f.repository.startAttempt(call.id, { provider: "twilio", userId: owner.id }))
    .rejects.toMatchObject({ code: "EMAIL_VERIFICATION_REQUIRED" });
  expect(await f.repository.getLatestAttempt(call.id)).toBeNull();
  expect(await f.repository.getCreditUsage(owner.id)).toEqual(before);
  await f.controls.updateRegistration({ onboarding: "full", emailVerification: "deferrable" }, (await f.controls.getView()).revision, f.admin.id, "Allow deferred email");
  expect((await f.repository.startAttempt(call.id, { provider: "twilio", userId: owner.id })).attempt.id).toEqual(expect.any(String));
}, 30_000);

it("persists analytics through the existing revisioned settings and preserves it for old beta clients", async () => {
  const f = await fixture();
  const before = await f.controls.getAnalytics();
  expect(before.settings).toEqual({ enabled: false, measurementId: "" });
  await f.controls.updateAnalytics({ enabled: true, measurementId: "G-TEST1234" }, before.revision, f.admin.id);
  const enabled = await f.controls.getAnalytics();
  await expect(f.controls.updateAnalytics({ enabled: false, measurementId: "" }, before.revision, f.admin.id)).rejects.toMatchObject({ code: "BETA_SETTINGS_STALE" });
  await f.controls.update(f.settings, enabled.revision, f.admin.id, "Unrelated budget update");
  expect((await f.controls.getAnalytics()).settings).toEqual(enabled.settings);
  expect(await f.sql`SELECT action FROM beta_control_audit WHERE reason='Analytics settings'`).toHaveLength(1);
});
afterEach(async () => { for (const close of closers.splice(0).reverse()) await close(); });
let phone = 1000;
function profile() { return { email: `${randomUUID()}@example.com`, passwordHash: "test-only",
  phoneE164: `+41790${String(++phone).padStart(6,"0")}`, firstName: "Beta", lastName: "Tester", uiLocale: "en" as const }; }
async function fixture(overrides: Partial<BetaSettings> = {}) {
  const db = isolatedTestDatabase(); await db.setup(); closers.push(() => db.teardown());
  const sql = postgres(db.url, { max: 5 }); closers.push(() => sql.end());
  const ungated = new PostgresAuthRepository(db.url); closers.push(() => ungated.close());
  const admin = await ungated.createUser({ ...profile(), passwordHash: await hashPassword("beta-admin-password") });
  await sql`UPDATE users SET role='superadmin',phone_verified_at=now(),email_verified_at=now() WHERE id=${admin.id}`;
  const auth = new PostgresAuthRepository(db.url, true); closers.push(() => auth.close());
  const repository = new PostgresCallRepository(db.url, Buffer.alloc(32,9), true);
  const service = new CallService(repository, undefined, undefined, undefined, undefined, undefined, undefined, { durableWorkerEnabled: false });
  const controls = repository.betaControls!;
  const settings = { ...defaultBetaSettings, rollingDayBudgetMicros: 100_000_000, ...overrides };
  await controls.update(settings, 1, admin.id, "Test beta configuration");
  const verification = new MockVerificationProvider();
  const authService = new AuthService({ repository: auth, verificationProvider: verification, signupCreditGranter: service, betaControls: controls });
  const app = buildApp({ service, authService, logger: false }); closers.push(() => app.close());
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: admin.email, password: "beta-admin-password" } });
  expect(login.statusCode).toBe(200);
  const cookie = String(login.headers["set-cookie"]);
  async function owner() {
    const user = await auth.createUser(profile());
    await sql`UPDATE users SET phone_verified_at=now(),email_verified_at=now() WHERE id=${user.id}`;
    await repository.grantSignupCredits(user.id);
    return user;
  }
  async function ready(userId: string, recipient = `+41780${String(++phone).padStart(6,"0")}`) {
    const call = await service.create({ recipientName: "Office", phoneNumber: recipient,
      objective: "Ask which documents are needed for registration", assistantProfileId: "sebastian",
      representedPersonFirstName: "Nina", representedPersonLastName: "Keller", locale: "de-CH", allowedFacts: [] }, userId);
    await repository.approveCompilation(call.id, await originalPlanReview(repository, call.id)); return call;
  }
  return { sql, auth, repository, service, controls, settings, admin, app, cookie, owner, ready, verification };
}

it("atomically caps public intake across connections; extra one-use invitations and duplicates cannot inflate it", async () => {
  const f = await fixture({ publicAccountLimit: 2 });
  const attempted = await Promise.allSettled(Array.from({ length: 8 }, () => f.auth.createUser(profile())));
  expect(attempted.filter(r => r.status === "fulfilled")).toHaveLength(2);
  expect(attempted.filter(r => r.status === "rejected").map(r => r.reason.code)).toEqual(Array(6).fill("BETA_REGISTRATION_FULL"));
  const invitation = await f.controls.createInvitation(f.admin.id, "Additional test participant");
  const extra = await Promise.allSettled([f.auth.createUser({ ...profile(), invitationCode: invitation.code }), f.auth.createUser({ ...profile(), invitationCode: invitation.code })]);
  expect(extra.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(extra.find(r => r.status === "rejected")).toMatchObject({ reason: { code: "BETA_INVITATION_INVALID" } });
  const view = await f.controls.getView();
  expect(view).toMatchObject({ publicAccounts: 2, invitedAccounts: 1 });
  expect(JSON.stringify(view)).not.toContain(invitation.code);
  expect(JSON.stringify(view)).not.toContain("token_hash");
  const invited = extra.find(r => r.status === "fulfilled")!;
  if (invited.status === "fulfilled") await f.sql`UPDATE users SET status='deleted' WHERE id=${invited.value.id}`;
  expect(await f.controls.getView()).toMatchObject({ publicAccounts: 2, invitedAccounts: 1 });
  await expect(f.auth.createUser({ ...profile(), invitationCode: invitation.code })).rejects.toMatchObject({ code: "BETA_INVITATION_INVALID" });
  const revoked = await f.controls.createInvitation(f.admin.id, "Revoke this invitation");
  await f.controls.revokeInvitation(revoked.id, f.admin.id, "Invitation no longer needed");
  await expect(f.auth.createUser({ ...profile(), invitationCode: revoked.code })).rejects.toMatchObject({ code: "BETA_INVITATION_INVALID" });
  const expired = await f.controls.createInvitation(f.admin.id, "Expired invitation fixture");
  await f.sql`UPDATE beta_invitations SET expires_at=now()-interval '1 second' WHERE id=${expired.id}`;
  await expect(f.auth.createUser({ ...profile(), invitationCode: expired.code })).rejects.toMatchObject({ code: "BETA_INVITATION_INVALID" });
}, 30000);

it("rolls back a consumed invitation and intake counter if account creation fails; signup credits remain idempotent", async () => {
  const f = await fixture();
  const first = await f.owner();
  const invitation = await f.controls.createInvitation(f.admin.id, "Invitation rollback fixture");
  await expect(f.auth.createUser({ ...profile(), email: first.email, invitationCode: invitation.code })).rejects.toMatchObject({ code: "USER_ALREADY_EXISTS" });
  const extra = await f.auth.createUser({ ...profile(), invitationCode: invitation.code });
  await expect(f.auth.createUser({ ...profile(), email: first.email })).rejects.toMatchObject({ code: "USER_ALREADY_EXISTS" });
  expect(await f.controls.getView()).toMatchObject({ publicAccounts: 1, invitedAccounts: 1 });
  await Promise.all(Array.from({length: 5}, () => f.repository.grantSignupCredits(first.id)));
  expect(await f.repository.getCreditUsage(first.id)).toMatchObject({ balance: 3 });
  expect(extra.id).not.toBe(first.id);
}, 30000);

it("reserves the last monetary capacity atomically across API/worker clients and never refunds uncertain spend", async () => {
  const f = await fixture({ rollingDayBudgetMicros: 1_000_000 });
  const worker = new PostgresBetaControls(f.sql);
  const attempts = await Promise.allSettled(Array.from({length: 8}, (_,i) => (i%2 ? worker : f.controls).reserve("sms", `sms:${randomUUID()}`)));
  expect(attempts.filter(r => r.status === "fulfilled")).toHaveLength(2);
  expect(attempts.filter(r => r.status === "rejected").map(r => r.reason.code)).toEqual(Array(6).fill("BETA_BUDGET_EXHAUSTED"));
  expect(await worker.getView()).toMatchObject({ reservedMicros: 1_000_000, budgetState: "exhausted" });
  await f.sql`UPDATE beta_spend_reservations SET created_at=now()-interval '25 hours'`;
  await Promise.all(Array.from({length: 5}, () => f.controls.reserve("text", "same-provider-request")));
  expect(await worker.getView()).toMatchObject({ reservedMicros: 500_000, budgetState: "available" });
  await f.controls.update({ ...f.settings, spendingEnabled: false }, 2, f.admin.id, "Global budget stop drill");
  await expect(worker.reserve("email", randomUUID())).rejects.toMatchObject({ code: "BETA_SPENDING_PAUSED" });
}, 30000);

it("admits two global calls, enforces per-account limits, and reserves the admitted full duration", async () => {
  const f = await fixture();
  const owners = await Promise.all([f.owner(),f.owner(),f.owner()]);
  const calls = await Promise.all(owners.map(o => f.ready(o.id)));
  const attempts = await Promise.allSettled(calls.map((c,i) => f.repository.startAttempt(c.id,{provider:"twilio",userId:owners[i].id})));
  const admitted = attempts.flatMap((r,i) => r.status === "fulfilled" ? [{ ...r.value, owner: owners[i] }] : []);
  expect(admitted).toHaveLength(2);
  expect(attempts.find(r=>r.status==="rejected")).toMatchObject({reason:{code:"BETA_CONCURRENCY_LIMIT"}});
  expect(admitted.every(a=>a.attempt.maxDurationSeconds===420)).toBe(true);
  expect(await f.controls.getView()).toMatchObject({activeCalls:2,reservedMicros:28_000_000});
  await f.controls.update({...f.settings,maxConcurrentCalls:3,maxDurationSeconds:300},2,f.admin.id,"Changed limits for new starts");
  const sameOwner = await f.ready(admitted[0].owner.id);
  await expect(f.repository.startAttempt(sameOwner.id,{provider:"twilio",userId:admitted[0].owner.id})).rejects.toMatchObject({code:"CONCURRENT_CALL_LIMIT"});
  expect(await f.controls.getView()).toMatchObject({reservedMicros:28_000_000});
  await f.repository.attachProviderCall(admitted[0].attempt.id,"CA-beta-one","queued");
  await f.repository.applyProviderStatus("CA-beta-one","busy","failed");
  const fresh = await f.repository.startAttempt(sameOwner.id,{provider:"twilio",userId:admitted[0].owner.id});
  expect(fresh.attempt.maxDurationSeconds).toBe(300);
  expect(await f.controls.getView()).toMatchObject({reservedMicros:38_000_000});
  const stored = await f.sql`SELECT max_duration_seconds FROM call_attempts WHERE id=${admitted[0].attempt.id}`;
  expect(stored[0].max_duration_seconds).toBe(420);
  await f.repository.setOutboundCallsEnabled(false,{actorUserId:f.admin.id,reason:"Stop drill"});
  const blocked = await f.ready(owners[2].id);
  await expect(f.repository.startAttempt(blocked.id,{provider:"twilio",userId:owners[2].id})).rejects.toMatchObject({code:"OUTBOUND_CALLS_DISABLED"});
}, 30000);

it("keeps uncertain provider calls in concurrency counts and recipient limits survive call data removal", async () => {
  const f = await fixture({ maxConcurrentCalls: 1, maxStartsPerRecipientPerDay: 1 });
  const firstOwner = await f.owner(), nextOwner = await f.owner();
  const recipient = "+41790009999";
  const first = await f.ready(firstOwner.id, recipient), next = await f.ready(nextOwner.id, recipient);
  const admitted = await f.repository.startAttempt(first.id, { provider: "twilio", userId: firstOwner.id });
  await f.repository.attachProviderCall(admitted.attempt.id, "CA-uncertain-beta", "queued");
  // Simulate a local failure whose provider stop could not be confirmed.
  await f.sql`UPDATE call_attempts SET ended_at=now(),status='failed' WHERE id=${admitted.attempt.id}`;
  expect(await f.controls.getView()).toMatchObject({ activeCalls: 1 });
  await expect(f.repository.startAttempt(next.id, { provider: "twilio", userId: nextOwner.id })).rejects.toMatchObject({ code: "BETA_CONCURRENCY_LIMIT" });
  await f.repository.applyProviderStatus("CA-uncertain-beta", "busy", "failed");
  expect(await f.controls.getView()).toMatchObject({ activeCalls: 0 });
  // Redaction of the original destination must not free the global recipient slot.
  await f.sql`UPDATE call_briefs SET phone_number='+41000000000' WHERE id=${first.id}`;
  await expect(f.repository.startAttempt(next.id, { provider: "twilio", userId: nextOwner.id })).rejects.toMatchObject({ code: "BETA_RECIPIENT_LIMIT" });
  expect(await f.controls.getView()).toMatchObject({ reservedMicros: 14_000_000 });
  await f.sql`UPDATE beta_recipient_starts SET created_at=now()-interval '25 hours'`;
  await expect(f.repository.startAttempt(next.id, { provider: "twilio", userId: nextOwner.id })).resolves.toBeDefined();
  expect((await f.sql`SELECT * FROM beta_recipient_starts`).count).toBe(1);
}, 30000);

it("preserves idempotent preparation lookup while spending is paused and rejects new registrations before occupying a place", async () => {
  const f = await fixture();
  const owner = await f.owner();
  const input = { recipientName: "Office", phoneNumber: "+41790009888", objective: "Ask for opening hours",
    assistantProfileId: "sebastian" as const, representedPersonFirstName: "Nina", representedPersonLastName: "Keller", locale: "de-CH" as const, allowedFacts: [] };
  const key = randomUUID(), preparation = await f.service.prepare(input, owner.id, key);
  await f.controls.update({ ...f.settings, rollingDayBudgetMicros: null }, 2, f.admin.id, "Unconfigured budget test");
  expect(await f.service.prepare(input, owner.id, key)).toMatchObject({ id: preparation.id });
  await expect(f.service.prepare(input, owner.id, randomUUID())).rejects.toMatchObject({ code: "BETA_BUDGET_UNCONFIGURED" });
  const before = (await f.controls.getView()).publicAccounts;
  const signup = await f.app.inject({ method: "POST", url: "/api/auth/register", payload: { ...profile(), password: "new-account-password" } });
  expect(signup.statusCode).toBe(503);
  expect(signup.json().error).toBe("BETA_BUDGET_UNCONFIGURED");
  expect((await f.controls.getView()).publicAccounts).toBe(before);
  expect(f.verification.requests).toHaveLength(0);
}, 30000);

it("keeps admin controls independent, role protected, revision checked and never sends a code after the public cap", async () => {
  const f = await fixture({publicAccountLimit:0});
  const url="/api/admin/system/beta";
  expect((await f.app.inject({method:"GET",url})).statusCode).toBe(401);
  const get=await f.app.inject({method:"GET",url,headers:{cookie:f.cookie}});
  expect(get.headers["cache-control"]).toBe("private, no-store");
  expect(betaControlsViewSchema.parse(get.json())).toMatchObject({settings:{publicAccountLimit:0,maxDurationSeconds:420},revision:2});
  const input={settings:{...f.settings,publicAccountLimit:30},expectedRevision:2,reason:"Open the next beta intake"};
  expect((await f.app.inject({method:"PUT",url,headers:{cookie:f.cookie,origin:"https://attacker.example"},payload:input})).statusCode).toBe(403);
  expect((await f.app.inject({method:"PUT",url,headers:{cookie:f.cookie},payload:{...input,reason:"x"}})).statusCode).toBe(400);
  vi.spyOn(f.repository,"getAdminSystemFacts").mockRejectedValue(new Error("diagnostics down"));
  expect((await f.app.inject({method:"PUT",url,headers:{cookie:f.cookie},payload:input})).statusCode).toBe(200);
  expect((await f.app.inject({method:"PUT",url,headers:{cookie:f.cookie},payload:input})).statusCode).toBe(409);
  await f.controls.update({...f.settings,publicAccountLimit:0},3,f.admin.id,"Close public intake again");
  const p=profile();
  const signup=await f.app.inject({method:"POST",url:"/api/auth/register",payload:{...p,password:"new-account-password"}});
  expect(signup.statusCode).toBe(503); expect(signup.json().error).toBe("BETA_REGISTRATION_FULL");
  expect(f.verification.requests).toHaveLength(0);
  await f.sql`UPDATE users SET role='admin' WHERE id=${f.admin.id}`;
  expect((await f.app.inject({method:"GET",url,headers:{cookie:f.cookie}})).statusCode).toBe(200);
  expect((await f.app.inject({method:"PUT",url,headers:{cookie:f.cookie},payload:input})).statusCode).toBe(403);
  expect((await f.app.inject({method:"POST",url:url+"/invitations",headers:{cookie:f.cookie},payload:{reason:"Must be superadmin"}})).statusCode).toBe(403);
}, 30000);

it("fails closed before real SMS/email dispatch when the monetary budget is exhausted", async () => {
  const f=await fixture({rollingDayBudgetMicros:null});
  const send=vi.fn();
  const sms=new TwilioVerificationProvider({accountSid:"ACtest",authToken:"fixture",serviceSid:"VAtest",betaControls:f.controls,
    client:{verify:{v2:{services:()=>({verifications:{create:send}})}}} as never});
  await expect(sms.send("+41790001000","de")).rejects.toMatchObject({code:"BETA_BUDGET_UNCONFIGURED"});
  expect(send).not.toHaveBeenCalled();
  const request=vi.fn(); const email=new ResendEmailProvider({apiKey:"fixture",from:"test@example.com",fetch:request,betaControls:f.controls});
  await expect(email.sendSecurityNotice({to:"test@example.com",locale:"en",kind:"password_reset",idempotencyKey:randomUUID()})).rejects.toMatchObject({code:"BETA_BUDGET_UNCONFIGURED"});
  expect(request).not.toHaveBeenCalled();
},30000);

it("reconciles persisted usage before concurrent admission without rewriting reservation history", async () => {
  const f = await fixture({ rollingDayBudgetMicros: 500_000, textRequestReserveMicros: 150_000 });
  const owner = await f.owner(), call = await f.ready(owner.id);
  const id = randomUUID();
  await f.controls.reserve("text", `provider:${id}`);
  await f.sql`INSERT INTO provider_operations(id,provider,operation_type,stage,requested_model,client_request_id,call_brief_id,started_at)
    VALUES(${id},'openai','brief_compilation','compilation','gpt-5.6',${id},${call.id},now())`;
  expect(await f.controls.getView()).toMatchObject({ pendingReserveMicros: 150_000, usageCostMicros: 0 });
  await f.sql`INSERT INTO provider_operation_results(operation_id,outcome,provider_model,completed_at,duration_ms)
    VALUES(${id},'invalid_response','gpt-5.6-sol',now(),1000)`;
  await f.sql`INSERT INTO provider_usage_records(id,operation_id,schema_version,input_text_tokens,output_text_tokens,total_tokens,raw_usage,observed_at)
    VALUES(${randomUUID()},${id},1,3000,400,3400,'{}',now())`;
  const view = await f.controls.getView();
  expect(betaControlsViewSchema.parse(view)).toMatchObject({ reservedMicros: 20_000, pendingReserveMicros: 0, usageCostMicros: 20_000 });
  const attempts = await Promise.allSettled(Array.from({ length: 5 }, () => f.controls.reserve("text", randomUUID())));
  expect(attempts.filter(r => r.status === "fulfilled")).toHaveLength(3);
  expect(await f.controls.getView()).toMatchObject({ reservedMicros: 470_000, pendingReserveMicros: 450_000, usageCostMicros: 20_000 });
  expect((await f.sql`SELECT amount_micros::int amount FROM beta_spend_reservations WHERE reservation_key=${`provider:${id}`}`)[0].amount).toBe(150_000);
  await f.sql`UPDATE beta_spend_reservations SET created_at=now()-interval '25 hours'`;
  expect(await f.controls.getView()).toMatchObject({ reservedMicros: 0 });
}, 30000);

it("accounts for a terminal call only after its provider cost arrives; late costs can exceed its reserve", async () => {
  const f = await fixture({ callMinuteReserveMicros: 600_000 });
  const owner = await f.owner(), brief = await f.ready(owner.id);
  const { attempt } = await f.repository.startAttempt(brief.id, { provider: "twilio", userId: owner.id });
  const leg = randomUUID(), session = randomUUID(), response = randomUUID();
  for (const [id, provider, type, model] of [[leg,"twilio","telephony_leg","programmable_voice"], [session,"openai","realtime_session","gpt-realtime-2.1"], [response,"openai","realtime_response","gpt-realtime-2.1"]]) {
    await f.sql`INSERT INTO provider_operations(id,provider,operation_type,stage,requested_model,client_request_id,call_brief_id,call_attempt_id,started_at)
      VALUES(${id},${provider},${type},'conversation',${model},${id},${brief.id},${attempt.id},now())`;
    await f.sql`INSERT INTO provider_operation_results(operation_id,outcome,completed_at,duration_ms) VALUES(${id},'succeeded',now(),1000)`;
  }
  await f.sql`INSERT INTO provider_usage_records(id,operation_id,schema_version,billable_seconds,raw_usage,observed_at) VALUES(${randomUUID()},${leg},1,120,'{}',now())`;
  await f.sql`INSERT INTO provider_usage_records(id,operation_id,schema_version,input_text_tokens,output_text_tokens,input_audio_tokens,output_audio_tokens,total_tokens,raw_usage,observed_at)
    VALUES(${randomUUID()},${response},1,1000,100,500,1000,2600,'{}',now())`;
  await f.sql`UPDATE call_attempts SET ended_at=now(),provider_status='completed' WHERE id=${attempt.id}`;
  expect(await f.controls.getView()).toMatchObject({ reservedMicros: 4_200_000 });
  await f.sql`INSERT INTO provider_cost_records(id,operation_id,provider,provider_cost_id,cost_basis,component,amount_micros,currency,raw_cost,observed_at)
    VALUES(${randomUUID()},${leg},'twilio',${leg},'provider_reported_actual','connectivity',360400,'USD','{}',now())`;
  expect(await f.controls.getView()).toMatchObject({ reservedMicros: 466_800, reportedCostMicros: 360_400, usageCostMicros: 86_400, pendingReserveMicros: 20_000 });
  expect(await f.controls.getView()).toMatchObject({ reservedMicros: 466_800 });
  // A late usage operation is included, even above the original reserve.
  const late = randomUUID();
  await f.sql`INSERT INTO provider_operations(id,provider,operation_type,stage,requested_model,client_request_id,call_attempt_id,started_at)
    VALUES(${late},'openai','realtime_response','conversation','gpt-realtime-2.1',${late},${attempt.id},now())`;
  await f.sql`INSERT INTO provider_operation_results(operation_id,outcome,completed_at,duration_ms) VALUES(${late},'succeeded',now(),1000)`;
  await f.sql`INSERT INTO provider_usage_records(id,operation_id,schema_version,input_text_tokens,output_text_tokens,input_audio_tokens,output_audio_tokens,total_tokens,raw_usage,observed_at)
    VALUES(${randomUUID()},${late},1,0,0,0,100000,100000,'{}',now())`;
  expect(await f.controls.getView()).toMatchObject({ reservedMicros: 6_866_800 });
}, 30000);
