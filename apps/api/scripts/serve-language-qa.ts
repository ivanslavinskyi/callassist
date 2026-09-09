/** Local, disposable browser-QA fixture. No database, external email, SMS, LLM or telephony. */
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildApp } from "../src/app";
import { CallService } from "../src/call-service";
import { InMemoryCallRepository } from "../src/storage/in-memory-call-repository";
import { InMemoryAuthRepository } from "../src/auth/in-memory-auth-repository";
import { AuthService } from "../src/auth/auth-service";
import { MockVerificationProvider } from "../src/auth/verification-provider";
import { MockEmailProvider } from "../src/auth/email-provider";
import { ContentService } from "../src/content/content-service";
import { InMemoryContentRepository } from "../src/content/in-memory-content-repository";
import { CreditService } from "../src/credits/credit-service";
import { MockTextProcessor } from "../src/text-processing/mock-text-processor";
import { MockTelephonyProvider } from "../src/telephony/mock-telephony-provider";
import { DeterministicBriefCompiler } from "../src/brief-compiler/brief-compiler";

if (process.env.NODE_ENV === "production") throw new Error("Local QA fixture must not run in production");
const qaPort = Number(process.env.QA_PORT ?? "4000");
if (!Number.isInteger(qaPort) || qaPort < 1 || qaPort > 65535) throw new Error("QA_PORT must be a valid port");
const qaOrigin = new URL(process.env.QA_WEB_ORIGIN ?? "http://localhost:3000");
if (qaOrigin.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(qaOrigin.hostname)) {
  throw new Error("QA_WEB_ORIGIN must be a local HTTP origin");
}
const repository = new InMemoryCallRepository();
const authRepository = new InMemoryAuthRepository();
const processor = new MockTextProcessor({ fixture: (input) => {
  const mark = `[QA MOCK ${input.targetLanguage}] `;
  if (input.kind === "plan_review" || input.kind === "clarification_review") {
    return { fields: input.fields.map((field) => ({ ...field, text: mark + field.text })) };
  }
  if (input.kind === "transcript_translation") {
    return { segments: input.segments.map((segment) => ({ id: segment.id, text: mark + segment.text })) };
  }
  const evidence = input.segments.find((segment) => segment.role === "recipient");
  return {
    answers: input.questions.map((question, index) => ({ questionId: `question.${index}`, question: mark + question,
      answer: evidence ? mark + "The office reported receipt of the form." : mark + "No answer is known.",
      certainty: evidence ? "reported" : "unknown", sourceSegmentIds: evidence ? [evidence.id] : [] })),
    nextSteps: [], unresolved: [mark + "No further steps were agreed in this fictional excerpt."]
  };
} });
const service = new CallService(repository, new MockTelephonyProvider(), undefined, undefined, new DeterministicBriefCompiler(), undefined, undefined,
  { textProcessor: processor });
const verificationCode = String(randomInt(1_000_000)).padStart(6, "0");
const auth = new AuthService({ repository: authRepository, verificationProvider: new MockVerificationProvider(verificationCode),
  emailProvider: new MockEmailProvider(), signupCreditGranter: service });
const content = new ContentService(new InMemoryContentRepository());
await content.initialize();
// These numbers are used exclusively by the mock providers above.
const mockSwissPhone = (prefix: "79" | "52") => `+41${prefix}${String(randomInt(10_000_000)).padStart(7, "0")}`;
const recipientPhoneNumber = mockSwissPhone("52");
const registration = { email: `qa-${randomUUID()}@example.test`, password: randomBytes(24).toString("base64url"),
  phoneE164: mockSwissPhone("79"), firstName: "QA", lastName: "Fixture", uiLocale: "de" as const };
await auth.register(registration, { ip: "127.0.0.1", userAgent: "local-language-qa-setup" });
const session = await auth.verifyPhone({ email: registration.email, code: verificationCode }, { ip: "127.0.0.1" });
// Test-only acceptance in ephemeral storage; the browser never submits legal acceptance for a real account.
const onboarding = await content.getOnboardingStatus(session.user.id, "de");
await content.acceptOnboarding(session.user.id, {
  locale: "de", termsRevisionId: onboarding.current.terms.id, acceptableUseRevisionId: onboarding.current.acceptableUse.id,
  acceptTerms: true, acceptAcceptableUse: true, acknowledgeConsent: true, acknowledgeRetention: true,
  acknowledgeUseLimits: true, acknowledgeCredits: true
});
const completed = await service.create({ recipientName: "QA Gemeinde — completed fixture", phoneNumber: recipientPhoneNumber,
  objective: "Ist mein Formular angekommen? Keine Termine vereinbaren.", assistantProfileId: "sebastian",
  representedPersonFirstName: registration.firstName, representedPersonLastName: registration.lastName,
  locale: "de-CH", allowedFacts: [`Name: ${registration.firstName} ${registration.lastName}`], audioRetentionDays: 0
}, session.user.id);
const initialContext = (await repository.getLanguageContext(completed.id))!;
const context = await repository.updateContentLanguage(completed.id, "ru", initialContext.selectionRevision);
const source = await repository.getPlanSource(completed.id);
await repository.approveCompilation(completed.id, { revision: source.revision, snapshotHash: source.snapshotHash,
  review: { mode: "original", language: "de-CH", selectionRevision: context.selectionRevision } });
// Repository recording fixtures use its historical provider tag; no Twilio provider is instantiated or called.
const attempt = await repository.startAttempt(completed.id, { provider: "twilio", userId: session.user.id });
const providerCallId = `mock-qa-${randomUUID()}`;
await repository.attachProviderCall(attempt.attempt.id, providerCallId, "in-progress");
const recording = await repository.beginRecording(completed.id);
const providerRecordingId = `mock-recording-qa-${randomUUID()}`;
await repository.attachProviderRecording(recording.recording.id, providerRecordingId, "in-progress");
await repository.applyRecordingStatus({ callBriefId: completed.id, recordingId: recording.recording.id, providerCallId,
  providerRecordingId, providerStatus: "completed", durationSeconds: 12, channels: 2 });
await repository.claimFinalTranscript(recording.recording.id, "qa-fixture");
await repository.completeFinalTranscript(recording.recording.id, "Ist das Formular angekommen?\nJa, das Formular ist angekommen.", [
  { role: "assistant", text: "Ist das Formular angekommen?", startSeconds: 0, endSeconds: 4 },
  { role: "recipient", text: "Ja, das Formular ist angekommen.", startSeconds: 5, endSeconds: 10 }
], undefined, { summaryGeneratorVersion: processor.generatorVersion });
await repository.updateStatus(completed.id, "completed");
service.wakeTextJobs();
const app = buildApp({ service, authService: auth, contentService: content,
  creditService: new CreditService({ repository, authRepository, hashKey: randomBytes(32) }),
  production: false, secureCookies: false, logger: false, webOrigin: qaOrigin.origin });
app.get("/__qa", async () => ({ fixture: "language-workflow", ephemeral: true, completedCallId: completed.id }));
const address = await app.listen({ port: qaPort, host: "127.0.0.1" });
const manifestDirectory = new URL("../../../.tools/language-qa/", import.meta.url);
const manifestPath = new URL("runtime.json", manifestDirectory);
try {
  await mkdir(manifestDirectory, { recursive: true });
  await writeFile(manifestPath, JSON.stringify({
    fixture: "language-workflow", ephemeral: true, createdAt: new Date().toISOString(),
    apiOrigin: address, webOrigin: qaOrigin.origin,
    credentials: { email: registration.email, password: registration.password },
    recipientPhoneNumber, completedCallId: completed.id, externalProviders: false
  }, null, 2) + "\n", { mode: 0o600 });
} catch (error) {
  await app.close();
  throw error;
}
console.log(`Local QA fixture ready at ${address}. Temporary login: ${fileURLToPath(manifestPath)}`);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
