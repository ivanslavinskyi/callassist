import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { defaultPreparationCapacity, preparationSettingsViewSchema, type UserRole } from "@callassist/contracts";
import { buildApp } from "./app";
import { AuthService } from "./auth/auth-service";
import { InMemoryAuthRepository } from "./auth/in-memory-auth-repository";
import { hashPassword } from "./auth/password";
import { MockVerificationProvider } from "./auth/verification-provider";
import { CallService } from "./call-service";
import { InMemoryCallRepository } from "./storage/in-memory-call-repository";

const url = "/api/admin/system/preparation";
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture() {
  const auth = new InMemoryAuthRepository();
  const user = await auth.createUser({ email: `${randomUUID()}@example.test`, passwordHash: await hashPassword("preparation-settings-password"),
    phoneE164: "+41710000991", firstName: "Test", lastName: "Admin", uiLocale: "en" });
  await auth.markPhoneVerified(user.id, new Date().toISOString());
  const repository = new InMemoryCallRepository();
  const service = new CallService(repository, undefined, undefined, undefined, undefined, undefined, undefined, { durableWorkerEnabled: false });
  const authService = new AuthService({ repository: auth, verificationProvider: new MockVerificationProvider(), signupCreditGranter: service });
  const app = buildApp({ service, authService, logger: false, secureCookies: false });
  cleanup.push(() => app.close());
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: user.email, password: "preparation-settings-password" } });
  expect(login.statusCode).toBe(200);
  return { auth, user, repository, app, cookie: String(login.headers["set-cookie"]) };
}
const input = { generation: { model: "gpt-5.6", serviceTier: "default" }, capacity: defaultPreparationCapacity, expectedRevision: 1, reason: "Test capacity" };
it("protects profile and capacity mutations with role, session and origin checks", async () => {
  const f = await fixture(), writes = vi.spyOn(f.repository,"updatePreparationSettings");
  expect((await f.app.inject({method:"GET",url})).statusCode).toBe(401);
  for (const role of ["user","support","content_editor","admin"] as UserRole[]) {
    await f.auth.setUserRoleForTest(f.user.id,role);
    expect((await f.app.inject({method:"PUT",url,headers:{cookie:f.cookie},payload:input})).statusCode).toBe(403);
    expect((await f.app.inject({method:"GET",url,headers:{cookie:f.cookie}})).statusCode).toBe(role === "admin" ? 200 : 403);
  }
  await f.auth.setUserRoleForTest(f.user.id,"superadmin");
  expect((await f.app.inject({method:"PUT",url,headers:{cookie:f.cookie,origin:"https://untrusted.example"},payload:input})).statusCode).toBe(403);
  expect(writes).not.toHaveBeenCalled();
});
it("switches every supported profile without reports or comments and records history", async () => {
  const f=await fixture(); await f.auth.setUserRoleForTest(f.user.id,"superadmin");
  const headers={cookie:f.cookie}; let revision=1;
  for (const model of ["gpt-5.6","gpt-5.6-terra","gpt-6-luna"]) for (const serviceTier of ["default","fast"]) {
    const result=await f.app.inject({method:"PUT",url,headers,payload:{generation:{model,serviceTier},capacity:defaultPreparationCapacity,expectedRevision:revision}});
    expect(result.statusCode).toBe(200); expect(result.headers["cache-control"]).toBe("private, no-store");
    const view=preparationSettingsViewSchema.parse(result.json());
    expect(view.policy).toMatchObject({revision:++revision,generation:{model,serviceTier},audit:{model:"gpt-5.6",serviceTier:"default"}});
    expect(view.history[0]).toMatchObject({actorUserId:f.user.id,reason:"",reportSha256:null});
  }
  expect((await f.app.inject({method:"PUT",url,headers,payload:input})).statusCode).toBe(409);
  expect((await f.repository.getPreparationSettings()).history).toHaveLength(6);
});

it("does not accept a client-supplied local testing capability", async () => {
  const f = await fixture(); await f.auth.setUserRoleForTest(f.user.id, "superadmin");
  const result = await f.app.inject({method:"PUT",url,headers:{cookie:f.cookie},payload:{...input,localTesting:true}});
  expect(result.statusCode).toBe(400);
  expect((await f.repository.getPreparationSettings()).policy.revision).toBe(1);
});
