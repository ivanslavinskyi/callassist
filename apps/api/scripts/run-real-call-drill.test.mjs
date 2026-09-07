import { randomUUID } from "node:crypto";
import { createCallBriefInputSchema } from "@callassist/contracts";
import { describe, expect, it, vi } from "vitest";
import { runRealCallDrill } from "./run-real-call-drill.mjs";

const callId = randomUUID();
const preparationId = randomUUID();
const env = { REAL_CALL_DRILL_EMAIL: "fixture@example.test", REAL_CALL_DRILL_PASSWORD: "test-only",
  REAL_CALL_DRILL_TARGET: "+41710000001" };

function harness({ failure, stalled = false, onboardingRequired = false, started = false } = {}) {
  const requests = [];
  let clock = 0;
  let polls = 0;
  const fetch = vi.fn(async (url, options) => {
    const path = url.pathname;
    requests.push({ path, ...options });
    let body; let status = 200; let headers;
    if (path === "/api/auth/login") { body = {}; headers = { "set-cookie": "callassist_session=fixture; HttpOnly" }; }
    else if (path === "/api/auth/logout") return new Response(null, { status: 204 });
    else if (path === "/api/onboarding/status") body = { required: onboardingRequired };
    else if (path === "/api/call-preparations") {
      createCallBriefInputSchema.parse(JSON.parse(options.body));
      expect(options.headers["Idempotency-Key"]).toMatch(/^[a-f0-9-]{36}$/);
      body = { id: preparationId, status: "queued", callBriefId: null }; status = 202;
    } else if (path === `/api/call-preparations/${preparationId}`) {
      polls += 1;
      body = { id: preparationId, status: failure || (stalled || polls === 1 ? "processing" : "succeeded"),
        callBriefId: !stalled && polls > 1 && !failure ? callId : null };
    } else if (path === `/api/call-briefs/${callId}/approve-and-start`) { started = true; body = { brief: { id: callId, status: "dialing" } }; }
    else if (path === `/api/call-briefs/${callId}`) body = { brief: { id: callId, status: started ? "completed" : "review_required" } };
    else throw new Error(`Unexpected request ${path}`);
    return Response.json(body, { status, headers });
  });
  return { requests, fetch, sleep: async (ms) => { clock += stalled ? 300_000 : ms; }, now: () => clock, write: vi.fn() };
}

describe("non-billable drill harness", () => {
  it("enqueues with stable idempotency, polls and returns before dialling", async () => {
    const h = harness(); const key = randomUUID();
    expect(await runRealCallDrill({ ...env, REAL_CALL_DRILL_IDEMPOTENCY_KEY: key }, h))
      .toEqual({ callId, status: "prepared" });
    expect(h.requests.find((r) => r.path === "/api/call-preparations").headers["Idempotency-Key"]).toBe(key);
    expect(h.requests.some((r) => /register|verify-phone|approve-and-start/.test(r.path))).toBe(false);
    expect(JSON.stringify(h.write.mock.calls)).not.toContain(env.REAL_CALL_DRILL_TARGET);
    expect(h.requests.at(-1).path).toBe("/api/auth/logout");
  });
  it("starts a reviewed existing brief without a worker-dependent preparation", async () => {
    const h = harness();
    expect(await runRealCallDrill({ ...env, REAL_CALL_DRILL_MODE: "start", REAL_CALL_DRILL_CALL_ID: callId,
      REAL_CALL_DRILL_CONFIRM: "CALL_AUTHORIZED" }, h)).toEqual({ callId, status: "completed" });
    expect(h.requests.some((r) => r.path.startsWith("/api/call-preparations"))).toBe(false);
    expect(h.requests.filter((r) => r.path.endsWith("approve-and-start"))).toHaveLength(1);
  });
  it.each(["failed", "cancelled"])("never dials after preparation %s", async (failure) => {
    const h = harness({ failure });
    await expect(runRealCallDrill(env, h)).rejects.toThrow("REAL_CALL_PREPARATION_FAILED");
    expect(h.requests.some((r) => r.path.endsWith("approve-and-start"))).toBe(false);
  });
  it("bounds preparation waiting when the worker is absent", async () => {
    await expect(runRealCallDrill(env, harness({ stalled: true }))).rejects.toThrow("REAL_CALL_PREPARATION_TIMEOUT");
  });
  it("requires explicit dial authorization before sending any request", async () => {
    const h = harness();
    await expect(runRealCallDrill({ ...env, REAL_CALL_DRILL_MODE: "start", REAL_CALL_DRILL_CALL_ID: callId }, h))
      .rejects.toThrow("CALL_AUTHORIZED");
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it("requires existing identity and never generates a Verify destination", async () => {
    const h = harness();
    await expect(runRealCallDrill({ REAL_CALL_DRILL_TARGET: env.REAL_CALL_DRILL_TARGET }, h)).rejects.toThrow("Existing verified");
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it("requires current policy acceptance in the UI", async () => {
    const h = harness({ onboardingRequired: true });
    await expect(runRealCallDrill(env, h)).rejects.toThrow("Terms/AUP");
    expect(h.requests.some((r) => r.path === "/api/call-preparations")).toBe(false);
  });
});
