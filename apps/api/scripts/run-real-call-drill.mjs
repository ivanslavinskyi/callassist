import { randomInt, randomUUID } from "node:crypto";

const apiUrl = process.env.REAL_CALL_DRILL_API_URL?.trim() ||
  "http://127.0.0.1:4000";
const target = process.env.REAL_CALL_DRILL_TARGET?.trim();
const verificationCode =
  process.env.REAL_CALL_DRILL_VERIFICATION_CODE?.trim();

if (process.env.REAL_CALL_DRILL_CONFIRM !== "CALL_AUTHORIZED") {
  throw new Error(
    "Set REAL_CALL_DRILL_CONFIRM=CALL_AUTHORIZED after recipient approval"
  );
}
if (!target) throw new Error("REAL_CALL_DRILL_TARGET is required");
if (!verificationCode) {
  throw new Error("REAL_CALL_DRILL_VERIFICATION_CODE is required");
}

const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
const accountPhone = `+4179000${String(randomInt(10_000)).padStart(4, "0")}`;
const registration = {
  email: `real-call-drill-${suffix}@example.test`,
  password: `Real-call-drill-${randomUUID()}!`,
  phoneE164: accountPhone,
  firstName: "Test",
  lastName: "Operator",
  uiLocale: "en"
};

await request("/api/auth/register", {
  method: "POST",
  body: registration,
  expectedStatus: 202
});
const verified = await request("/api/auth/verify-phone", {
  method: "POST",
  body: { email: registration.email, code: verificationCode },
  expectedStatus: 200,
  includeResponse: true
});
const cookie = verified.response.headers.get("set-cookie")?.split(";", 1)[0];
if (!cookie) throw new Error("Verification did not create a session");

const onboarding = await request("/api/onboarding/status?locale=en", {
  cookie,
  includeResponse: true
});
const current = onboarding.body.current;
await request("/api/onboarding/accept", {
  method: "POST",
  cookie,
  body: {
    locale: "en",
    termsRevisionId: current.terms.id,
    acceptableUseRevisionId: current.acceptableUse.id,
    acceptTerms: true,
    acceptAcceptableUse: true,
    acknowledgeConsent: true,
    acknowledgeRetention: true,
    acknowledgeUseLimits: true,
    acknowledgeCredits: true
  }
});

const created = await request("/api/call-briefs", {
  method: "POST",
  cookie,
  body: {
    recipientName: "Тестовый получатель",
    phoneNumber: target,
    objective:
      "После согласия сообщить, что это контролируемая инженерная проверка CallAssist. " +
      "Спросить, хорошо ли получатель слышит ассистента. Зафиксировать только ответ " +
      "да или нет, поблагодарить и вежливо завершить звонок.",
    assistantProfileId: "sebastian",
    representedPersonFirstName: "Тестовый",
    representedPersonLastName: "Оператор",
    assistanceReason: "language_barrier",
    locale: "ru-RU",
    audioRetentionDays: 0,
    allowLanguageSwitch: false,
    allowedFacts: []
  },
  expectedStatus: 201,
  includeResponse: true,
  timeoutMs: 120_000
});
const callId = created.body.id;
process.stdout.write(`${JSON.stringify({
  event: "real_call_brief_created",
  callId,
  status: created.body.status
})}\n`);

const started = await request(`/api/call-briefs/${callId}/approve-and-start`, {
  method: "POST",
  cookie,
  includeResponse: true,
  timeoutMs: 120_000
});
process.stdout.write(`${JSON.stringify({
  event: "real_call_started",
  callId,
  status: started.body.brief.status
})}\n`);

let previousStatus = started.body.brief.status;
const deadline = Date.now() + 10 * 60_000;
while (Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  try {
    const snapshot = await request(`/api/call-briefs/${callId}`, {
      cookie,
      includeResponse: true,
      timeoutMs: 10_000
    });
    const status = snapshot.body.brief.status;
    if (status !== previousStatus) {
      previousStatus = status;
      process.stdout.write(`${JSON.stringify({
        event: "real_call_status",
        callId,
        status
      })}\n`);
    }
    if (["completed", "failed", "stopped"].includes(status)) break;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      event: "real_call_poll_unavailable",
      callId,
      code: error instanceof Error ? error.message : "UNKNOWN"
    })}\n`);
  }
}
process.stdout.write(`${JSON.stringify({
  event: "real_call_drill_finished",
  callId,
  status: previousStatus
})}\n`);
if (!["completed", "failed", "stopped"].includes(previousStatus)) {
  throw new Error(`REAL_CALL_DRILL_TIMEOUT_${previousStatus}`);
}

async function request(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 30_000
  );
  try {
    const response = await fetch(`${apiUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...(options.cookie ? { cookie: options.cookie } : {})
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      signal: controller.signal
    });
    const body = response.status === 204 ? null : await response.json();
    if (
      options.expectedStatus !== undefined &&
      response.status !== options.expectedStatus
    ) {
      throw new Error(
        `${path}:${response.status}:${controlledErrorCode(body)}`
      );
    }
    if (!response.ok) {
      throw new Error(`${path}:${response.status}:${controlledErrorCode(body)}`);
    }
    return options.includeResponse ? { response, body } : body;
  } finally {
    clearTimeout(timeout);
  }
}

function controlledErrorCode(body) {
  return body && typeof body === "object" && typeof body.error === "string"
    ? body.error
    : "REQUEST_FAILED";
}
