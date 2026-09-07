import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

// Two invocations leave a review/worker-stop boundary. No registration or SMS.
export async function runRealCallDrill(environment = process.env, dependencies = {}) {
  const fetchImpl = dependencies.fetch ?? fetch;
  const sleep = dependencies.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = dependencies.now ?? Date.now;
  const write = dependencies.write ?? ((event) => process.stdout.write(`${JSON.stringify(event)}\n`));
  const apiUrl = new URL(environment.REAL_CALL_DRILL_API_URL?.trim() || "http://127.0.0.1:4000");
  if (!["http:", "https:"].includes(apiUrl.protocol) || apiUrl.username || apiUrl.password ||
    apiUrl.pathname !== "/" || apiUrl.search || apiUrl.hash ||
    (apiUrl.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(apiUrl.hostname))) {
    throw new Error("REAL_CALL_DRILL_API_URL must be HTTPS or loopback HTTP origin");
  }
  const mode = environment.REAL_CALL_DRILL_MODE?.trim() || "prepare";
  if (!["prepare", "start"].includes(mode)) throw new Error("REAL_CALL_DRILL_MODE must be prepare or start");
  const email = environment.REAL_CALL_DRILL_EMAIL?.trim();
  const password = environment.REAL_CALL_DRILL_PASSWORD;
  if (!email || !password) throw new Error("Existing verified REAL_CALL_DRILL_EMAIL and REAL_CALL_DRILL_PASSWORD are required");
  const target = environment.REAL_CALL_DRILL_TARGET?.trim();
  let callId = environment.REAL_CALL_DRILL_CALL_ID?.trim();
  const reviewedRevision = Number(environment.REAL_CALL_DRILL_REVISION);
  const reviewedHash = environment.REAL_CALL_DRILL_SNAPSHOT_HASH?.trim();
  const idempotencyKey = environment.REAL_CALL_DRILL_IDEMPOTENCY_KEY?.trim() || randomUUID();
  if (mode === "prepare" && (!target || !/^\+41\d{9}$/.test(target))) throw new Error("REAL_CALL_DRILL_TARGET must be an approved CH E.164 destination");
  if (mode === "prepare" && !isUuid(idempotencyKey)) throw new Error("Invalid REAL_CALL_DRILL_IDEMPOTENCY_KEY");
  if (mode === "start") {
    if (!isUuid(callId)) throw new Error("REAL_CALL_DRILL_CALL_ID must be a prepared call UUID");
    if (environment.REAL_CALL_DRILL_CONFIRM !== "CALL_AUTHORIZED") {
      throw new Error("Set REAL_CALL_DRILL_CONFIRM=CALL_AUTHORIZED after reviewing the prepared call and obtaining recipient approval");
    }
    if (!Number.isSafeInteger(reviewedRevision) || reviewedRevision < 1 || !/^[a-f0-9]{64}$/.test(reviewedHash ?? "")) {
      throw new Error("REAL_CALL_DRILL_REVISION and REAL_CALL_DRILL_SNAPSHOT_HASH must identify the reviewed plan");
    }
  }
  let cookie;
  async function request(path, options = {}) {
    const response = await fetchImpl(new URL(path, apiUrl), {
      method: options.method ?? "GET", redirect: "error",
      headers: {
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
        ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {})
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      signal: AbortSignal.timeout(30_000)
    });
    const body = response.status === 204 ? null : await response.json();
    if (!response.ok || (options.expectedStatus && response.status !== options.expectedStatus)) {
      const code = /^[A-Z][A-Z0-9_]{0,80}$/.test(body?.error) ? body.error : "REQUEST_FAILED";
      throw new Error(`DRILL_HTTP_${response.status}_${code}`);
    }
    return { body, response };
  }
  const login = await request("/api/auth/login", { method: "POST", body: { email, password }, expectedStatus: 200 });
  cookie = login.response.headers.get("set-cookie")?.split(";", 1)[0];
  if (!cookie) throw new Error("Login did not create a session");
  try {
    const { body: onboarding } = await request("/api/onboarding/status?locale=en");
    if (onboarding.required) throw new Error("Accept the current Terms/AUP in the web UI before this drill");
    if (mode === "prepare") {
      write({ event: "real_call_preparation_requested", idempotencyKey });
      let { body: preparation } = await request("/api/call-preparations", {
        method: "POST", expectedStatus: 202, idempotencyKey,
        body: {
          recipientName: "Test recipient", phoneNumber: target,
          objective: "After consent, explain this is a controlled SHPROHLI engineering check. Ask whether the recipient can hear the assistant clearly. Record only yes or no, thank them and politely end the call.",
          assistantProfileId: "sebastian", representedPersonFirstName: "Test",
          representedPersonLastName: "Operator", assistanceReason: "language_barrier",
          locale: "ru-RU", audioRetentionDays: 0, allowLanguageSwitch: false, allowedFacts: []
        }
      });
      if (!isUuid(preparation.id)) throw new Error("Invalid preparation response");
      const preparationId = preparation.id;
      const deadline = now() + 5 * 60_000;
      while (["queued", "processing", "retrying"].includes(preparation.status)) {
        if (now() >= deadline) throw new Error("REAL_CALL_PREPARATION_TIMEOUT");
        await sleep(2_000);
        ({ body: preparation } = await request(`/api/call-preparations/${preparationId}`));
        if (preparation.id !== preparationId) throw new Error("Preparation response mismatch");
      }
      if (preparation.status !== "succeeded" || !isUuid(preparation.callBriefId)) throw new Error("REAL_CALL_PREPARATION_FAILED");
      callId = preparation.callBriefId;
      const { body: snapshot } = await request(`/api/call-briefs/${callId}`);
      if (snapshot.brief.id !== callId || snapshot.brief.status !== "review_required") throw new Error("Prepared call is not awaiting review");
      write({ event: "real_call_prepared", callId, status: snapshot.brief.status,
        revision: snapshot.compilation.revision, snapshotHash: snapshot.compilation.snapshotHash });
      return { callId, status: "prepared" };
    }
    const { body: snapshot } = await request(`/api/call-briefs/${callId}`);
    if (snapshot.brief.id !== callId || !["review_required", "ready"].includes(snapshot.brief.status)) throw new Error("Call is not prepared for starting");
    if (snapshot.compilation.revision !== reviewedRevision || snapshot.compilation.snapshotHash !== reviewedHash) {
      throw new Error("Reviewed plan changed; review the current compilation before starting");
    }
    const { body: started } = await request(`/api/call-briefs/${callId}/approve-and-start`, { method: "POST", body: {
      revision: reviewedRevision,
      snapshotHash: reviewedHash
    } });
    let status = started.brief.status;
    write({ event: "real_call_started", callId, status });
    const deadline = now() + 10 * 60_000;
    while (!["completed", "failed", "stopped"].includes(status)) {
      if (now() >= deadline) throw new Error("REAL_CALL_DRILL_TIMEOUT");
      await sleep(2_000);
      const { body: snapshot } = await request(`/api/call-briefs/${callId}`);
      status = snapshot.brief.status;
    }
    write({ event: "real_call_drill_finished", callId, status });
    return { callId, status };
  } finally {
    await request("/api/auth/logout", { method: "POST" }).catch(() => undefined);
  }
}

function isUuid(value) {
  return typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runRealCallDrill();
}
