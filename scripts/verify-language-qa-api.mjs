/** HTTP smoke test against serve-language-qa.ts only; refuses a normal application server. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const runtime = JSON.parse(await readFile(new URL("../.tools/language-qa/runtime.json", import.meta.url), "utf8"));
assert.equal(runtime.fixture, "language-workflow");
assert.equal(runtime.ephemeral, true);
assert.equal(runtime.externalProviders, false);
const apiOrigin = new URL(runtime.apiOrigin);
const webOrigin = new URL(runtime.webOrigin);
for (const origin of [apiOrigin, webOrigin]) {
  assert.equal(origin.protocol, "http:");
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname), "QA origins must be local");
}
assert.equal(typeof runtime.credentials?.email, "string");
assert.equal(typeof runtime.credentials?.password, "string");
assert.match(runtime.recipientPhoneNumber, /^\+41\d{9}$/);
const base = apiOrigin.origin;
const fixture = await fetch(`${base}/__qa`, { redirect: "error" }).then((response) => response.json());
assert.equal(fixture.fixture, "language-workflow");
assert.equal(fixture.ephemeral, true);
assert.equal(fixture.completedCallId, runtime.completedCallId, "The local QA manifest belongs to a different fixture instance");
let cookie = "";
async function api(path, method = "GET", body) {
  const response = await fetch(`${base}${path}`, { method, headers: {
    Origin: webOrigin.origin, ...(cookie ? { Cookie: cookie } : {}),
    ...(body ? { "Content-Type": "application/json" } : {}),
    ...(path === "/api/call-preparations" ? { "Idempotency-Key": randomUUID() } : {})
  }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (path === "/api/auth/login") cookie = response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ");
  const value = await response.json();
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${value.error ?? ""}`);
  return value;
}
async function until(read, done) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const value = await read();
    if (done(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Fixture polling exhausted");
}
await api("/api/auth/login", "POST", runtime.credentials);
const initial = await api(`/api/call-briefs/${fixture.completedCallId}`);
await api("/api/account/language-preferences", "PATCH", { uiLocale: "en" });
const changed = await api(`/api/call-briefs/${fixture.completedCallId}`);
assert.deepEqual(changed.languageContext, initial.languageContext);
assert.equal(changed.brief.locale, "de-CH");
await api("/api/account/language-preferences", "PATCH", { uiLocale: "de" });
const preparation = await api("/api/call-preparations", "POST", { requestVersion: 2,
  brief: { recipientName: "QA API workflow", phoneNumber: runtime.recipientPhoneNumber, objective: "Ist mein Formular angekommen? Keine Termine vereinbaren.",
    assistantProfileId: "sebastian", representedPersonFirstName: "QA", representedPersonLastName: "Fixture", locale: "de-CH",
    allowedFacts: ["Name: QA Fixture", "Formular am 2. September gesendet."], audioRetentionDays: 0 },
  languagePreferences: { mode: "manual", targetLanguage: "ru", uiLocaleHint: "de" }
});
const prepared = await until(() => api(`/api/call-preparations/${preparation.id}`), (value) => value.status === "succeeded");
const snapshot = await api(`/api/call-briefs/${prepared.callBriefId}`);
assert.equal(snapshot.languageContext.taskContentLanguage, "ru");
const request = { compilationId: snapshot.planSource.compilationId, revision: snapshot.planSource.revision,
  snapshotHash: snapshot.planSource.snapshotHash, targetLanguage: "ru" };
const reviewRequest = await api(`/api/call-briefs/${snapshot.id ?? snapshot.brief.id}/plan-review`, "POST", request);
const callId = snapshot.id ?? snapshot.brief.id;
const review = await until(() => api(`/api/call-briefs/${callId}/text-artifacts/${reviewRequest.id}`), (value) => value.status === "ready");
const started = await api(`/api/call-briefs/${callId}/approve-and-start`, "POST", {
  revision: request.revision, snapshotHash: request.snapshotHash,
  review: { mode: "translated", language: "ru", artifactId: review.id, artifactHash: review.payloadHash,
    selectionRevision: snapshot.languageContext.selectionRevision }
});
assert.equal(started.brief.status, "dialing");
const original = initial.finalTranscriptRevision;
assert.ok(original?.segments.length);
const translationRequest = await api(`/api/call-briefs/${fixture.completedCallId}/final-transcript/translations`, "POST",
  { sourceRevisionId: original.id, targetLanguage: "ru" });
const translation = await until(() => api(`/api/call-briefs/${fixture.completedCallId}/text-artifacts/${translationRequest.id}`), (value) => value.status === "ready");
assert.deepEqual(translation.payload.segments.map(({ id, role, startSeconds, endSeconds }) => ({ id, role, startSeconds, endSeconds })),
  original.segments.map(({ id, role, startSeconds, endSeconds }) => ({ id, role, startSeconds, endSeconds })));
const result = await until(() => api(`/api/call-briefs/${fixture.completedCallId}/text-artifacts`),
  (value) => value.items.some((item) => item.kind === "call_summary" && item.status === "ready"));
const summary = result.items.find((item) => item.kind === "call_summary" && item.status === "ready");
assert.ok(summary.payload.answers.every((answer) => answer.sourceSegmentIds.every((id) => original.segments.some((segment) => segment.id === id))));
const report = { fixture: fixture.fixture, verifiedAt: new Date().toISOString(), browserE2E: false, externalProviders: false,
  checks: ["authenticated login", "UI preference preserves task and call languages", "v2 preparation with manual Russian/DE call",
    "durable plan artifact", "translated review receipt and mock call start", "immutable transcript segment identity",
    "translated transcript", "summary original source references"], callId, completedCallId: fixture.completedCallId };
const reportDirectory = new URL("../.tools/verification-language/", import.meta.url);
await mkdir(reportDirectory, { recursive: true });
await writeFile(new URL("language-qa-api.json", reportDirectory), JSON.stringify(report, null, 2) + "\n");
console.log(`Local QA workflow passed ${report.checks.length} checks. Report: .tools/verification-language/language-qa-api.json`);
