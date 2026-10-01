/** Isolated browser acceptance: fresh disposable PostgreSQL database, synthetic
 * accounts/plans, mock communications, no workers or external provider traffic.
 * From apps/api: node --import tsx ../../scripts/preproduction-browser-smoke.mts
 * Set PLAYWRIGHT_MODULE_PATH when Playwright is installed outside this workspace.
 */
import "../apps/api/src/config/load-env.ts";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { isolatedTestDatabase } from "../apps/api/src/db/isolated-test-database.ts";
import { PostgresAuthRepository } from "../apps/api/src/auth/postgres-auth-repository.ts";
import { PostgresCallRepository } from "../apps/api/src/storage/postgres-call-repository.ts";
import { PostgresContentRepository } from "../apps/api/src/content/postgres-content-repository.ts";
import { ContentService } from "../apps/api/src/content/content-service.ts";
import { AuthService, hashSessionToken } from "../apps/api/src/auth/auth-service.ts";
import { MockVerificationProvider } from "../apps/api/src/auth/verification-provider.ts";
import { MockEmailProvider } from "../apps/api/src/auth/email-provider.ts";
import { CallService } from "../apps/api/src/call-service.ts";
import { DeterministicBriefCompiler } from "../apps/api/src/brief-compiler/brief-compiler.ts";
import { createCompilationSnapshotHash } from "../apps/api/src/brief-compiler/compilation-integrity.ts";
import { PlanReviewService } from "../apps/api/src/safety/plan-review-service.ts";
import { TelemetryExportService } from "../apps/api/src/telemetry-export/service.ts";
import { SuperadminNotifications } from "../apps/api/src/notifications/superadmin-notifications.ts";
import { buildApp } from "../apps/api/src/app.ts";
import { betaPlacesText, betaAllowanceText, betaCreditMessages } from "../apps/web/lib/i18n/beta-credit-messages.ts";

const apiRequire = createRequire(new URL("../apps/api/package.json", import.meta.url));
const webRequire = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { default: postgres } = await import(pathToFileURL(apiRequire.resolve("postgres")).href);
const { defaultBetaSettings, normalizeCreateCallBriefInput, uiLocales } = await import(pathToFileURL(apiRequire.resolve("@callassist/contracts")).href);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : "playwright");
const cleanupOnly = process.argv.includes("--cleanup-only");
const root = fileURLToPath(new URL("../", import.meta.url));
const apiPort = Number(process.env.SMOKE_API_PORT ?? 4327), webPort = Number(process.env.SMOKE_WEB_PORT ?? 3327);
assert(![3000, 4000].includes(apiPort) && ![3000, 4000].includes(webPort), "Use isolated ports");
const site = `http://127.0.0.1:${webPort}`, apiUrl = `http://127.0.0.1:${apiPort}`;
const output = new URL("../.tools/preproduction-browser-smoke/", import.meta.url);
await mkdir(output, { recursive: true });
const log = await open(new URL(cleanupOnly ? "cleanup.log" : "next.log", output), "w");
const nextEnvPath = new URL("../apps/web/next-env.d.ts", import.meta.url);
const tsconfigPath = new URL("../apps/web/tsconfig.json", import.meta.url);
const database = isolatedTestDatabase(), key = Buffer.alloc(32, 31);
let sql, authRepository, content, app, next, browser, page, repository, service, reviews, exports, notifications;
const browserErrors: string[] = [], httpErrors: string[] = [], requestsFailed: string[] = [];
const assertions: string[] = [];
function passed(message: string) { assertions.push(message); console.log(`PASS: ${message}`); }
try {
  await database.setup();
  sql = postgres(database.url, { max: 3 });
  authRepository = new PostgresAuthRepository(database.url, true);
  repository = new PostgresCallRepository(database.url, key, true);
  const compiler = new DeterministicBriefCompiler();
  service = new CallService(repository, undefined, undefined, undefined, compiler, undefined, undefined, { durableWorkerEnabled: false });
  content = new ContentService(new PostgresContentRepository(database.url)); await content.initialize();
  const email = new MockEmailProvider();
  const auth = new AuthService({ repository: authRepository, signupCreditGranter: service,
    verificationProvider: new MockVerificationProvider("123456"), emailProvider: email });
  reviews = new PlanReviewService(database.url, key);
  exports = new TelemetryExportService(database.url, key, { streamRecordingMedia: async () => { throw new Error("Browser smoke must never fetch provider audio"); } });
  notifications = new SuperadminNotifications(database.url, key, email, { siteUrl: site }, repository);
  await sql`UPDATE beta_controls SET settings=${sql.json({ ...defaultBetaSettings, publicAccountLimit: 30, showRegistrationRemaining: true,
    registration: { onboarding: "registration", emailVerification: "deferrable" }, rollingDayBudgetMicros: 100_000_000 })} WHERE id=true`;
  const operator = randomUUID(), owner = randomUUID(), token = randomUUID();
  for (const [id, role, phone] of [[operator, "superadmin", "+41730000001"], [owner, "user", "+41730000002"]]) {
    await sql`INSERT INTO users(id,email,password_hash,phone_e164,phone_verified_at,email_verified_at,first_name,last_name,role,status,ui_locale,created_at)
      VALUES(${id},${`${id}@example.test`},'fixture-only',${phone},now(),now(),'Browser','Fixture',${role},'active','en',now())`;
  }
  const legal = (await content.getOnboardingStatus(operator, "en")).current;
  await content.acceptOnboarding(operator, { locale: "en", termsRevisionId: legal.terms.id, acceptableUseRevisionId: legal.acceptableUse.id,
    acceptTerms: true, acceptAcceptableUse: true, acknowledgeConsent: true, acknowledgeRetention: true, acknowledgeUseLimits: true, acknowledgeCredits: true });
  const now = new Date().toISOString();
  await authRepository.createSession({ id: randomUUID(), userId: operator, tokenHash: hashSessionToken(token),
    expiresAt: new Date(Date.now() + 3600000).toISOString(), revokedAt: null, createdAt: now, lastSeenAt: now, userAgent: "Isolated browser acceptance" });
  const input = normalizeCreateCallBriefInput({ recipientName: "Synthetic Office", phoneNumber: "+41525550111", representedPersonFirstName: "Browser", representedPersonLastName: "Fixture",
    objective: "Ask when the synthetic office opens", locale: "en-GB", allowedFacts: [], assistantProfileId: "sebastian" });
  const compilation = await compiler.compile(input, 1);
  compilation.policyDecision = { ...compilation.policyDecision, status: "blocked", reasonCodes: ["prohibited_content"], riskLevel: "high" };
  compilation.snapshotHash = createCompilationSnapshotHash(compilation);
  const brief = await repository.create(compilation.rawBrief, compilation, owner);
  const caseId = (await reviews.list({ callId: brief.id, limit: 25 })).items[0]!.id;
  app = buildApp({ service, authService: auth, contentService: content, planReviews: reviews, telemetryExports: exports,
    notifications, logger: false, secureCookies: false, webOrigin: site, trustedProxyCidrs: "none" });
  await app.listen({ host: "127.0.0.1", port: apiPort });
  if (cleanupOnly) {
    assert.equal((await reviews.list({ callId: brief.id, limit: 25 })).items.length, 1);
    passed("Fresh isolated services opened and queried; exercising cleanup without a browser or providers");
  } else {
  next = spawn(process.execPath, [webRequire.resolve("next/dist/bin/next"), "dev", "--port", String(webPort), "--hostname", "127.0.0.1"], {
    cwd: `${root}apps/web`, windowsHide: true, stdio: ["ignore", log.fd, log.fd],
    env: { ...process.env, NODE_ENV: "development", NEXT_DIST_DIR: ".next-preproduction-smoke", NEXT_PUBLIC_API_URL: apiUrl, INTERNAL_API_URL: apiUrl, NEXT_PUBLIC_SITE_URL: site }
  });
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    try { const probe = await fetch(`${site}/en/register`); await probe.arrayBuffer(); if (probe.ok) { ready = true; break; } } catch {}
    if (next.exitCode !== null) throw new Error("Next exited before readiness; inspect local next.log");
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert(ready, "Isolated Next did not become ready");
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    return [site, apiUrl].includes(url.origin) || ["data:", "blob:"].includes(url.protocol) ? route.continue() : route.abort("blockedbyclient");
  });
  page = await context.newPage(); page.setDefaultTimeout(45000); page.setDefaultNavigationTimeout(180000);
  page.on("pageerror", error => browserErrors.push(error.message));
  page.on("console", message => { if (message.type() === "error" && !(message.text().includes("401") && message.location().url.includes("/api/auth/me"))) browserErrors.push(message.text()); });
  page.on("response", response => { if (response.status() >= 400 && !(response.status() === 401 && new URL(response.url()).pathname === "/api/auth/me")) httpErrors.push(`${response.status()} ${new URL(response.url()).pathname}`); });
  page.on("requestfailed", request => { const entry = `${request.url()} ${request.failure()?.errorText}`; requestsFailed.push(entry); console.log("Request failure", entry); });
  page.on("response", async response => { if (response.url().includes("/api/auth/registration-options")) console.log("Registration response", response.status(), response.url(), JSON.stringify((await response.json().catch(() => ({}))).beta)); });
  page.on("dialog", dialog => dialog.accept());
  async function screenshot(name: string, widths = [1440, 390]) {
    for (const width of widths) {
      await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: document overflow at ${width}`);
      await page.screenshot({ path: fileURLToPath(new URL(`${name}-${width}.png`, output)), fullPage: true });
    }
  }
  for (const locale of uiLocales) {
    await page.goto(`${site}/${locale}/register`);
    const seats = page.getByText(betaPlacesText(30, locale), { exact: true });
    await Promise.race([seats.waitFor(), page.locator('.auth-form [role="alert"] button').waitFor()]);
    if (!await seats.isVisible()) { console.log("Retrying registration options after visible fetch error", locale); await page.locator('.auth-form [role="alert"] button').click(); }
    await seats.waitFor();
    await page.getByText(betaAllowanceText({ amount: 3, period: "lifetime" }, locale), { exact: true }).waitFor();
    if (await page.locator(".privacy-notice button").isVisible()) await page.locator(".privacy-notice button").click();
    await screenshot(`registration-${locale}`, [1440, 390, 320]);
  }
  passed("Registration seats and allowance translated in seven locales, desktop/390px/320px without page overflow");
  await context.addCookies([{ name: "callassist_session", value: token, url: site, httpOnly: true, sameSite: "Lax" }]);
  await page.goto(`${site}/admin/safety`);
  await page.getByRole("link", { name: "Revision 1 · en-GB", exact: true }).waitFor();
  await screenshot("safety-list");
  await page.locator('select[name="category"]').selectOption("clarification");
  await page.getByRole("button", { name: "Apply filters", exact: true }).click();
  await page.getByText("No returned plans match these filters.", { exact: true }).waitFor();
  await page.locator('select[name="category"]').selectOption("policy_signal");
  await page.getByRole("button", { name: "Apply filters", exact: true }).click();
  await page.getByRole("link", { name: "Revision 1 · en-GB", exact: true }).click();
  await page.waitForURL(`${site}/admin/safety/plan-reviews/${caseId}`);
  await page.getByLabel("Reason for access", { exact: true }).fill("Synthetic browser evidence review");
  await page.getByRole("button", { name: "Open evidence and record access", exact: true }).click();
  await page.getByRole("heading", { name: "Original request", exact: true }).waitFor();
  await page.locator('select[name="status"]').selectOption("in_review");
  await page.getByLabel("Private review note", { exact: true }).fill("Synthetic browser case, no actual allegation.");
  await page.getByLabel("Reason for change", { exact: true }).fill("Test case triage");
  await page.getByRole("button", { name: "Save review", exact: true }).click();
  await page.getByText("Review saved.", { exact: true }).waitFor();
  assert.equal((await reviews.get(caseId)).item.status, "in_review");
  await screenshot("safety-evidence");
  await page.getByRole("link", { name: "Recipient restrictions", exact: true }).click();
  await page.locator('input[name="phoneE164"]').first().waitFor();
  await screenshot("safety-recipients");
  passed("Safety queue filters, immutable evidence access, audited triage, recipient tab on desktop/mobile");
  await page.goto(`${site}/admin/system`);
  await page.getByRole("heading", { name: "Call credits", exact: true }).waitFor();
  await page.getByLabel("Credits", { exact: true }).fill("5");
  await page.locator('#beta-controls select[name="period"]').selectOption("week");
  await page.getByLabel("Reason for this policy", { exact: true }).fill("Browser fixture weekly allowance");
  await page.getByRole("button", { name: "Save default for new accounts", exact: true }).click();
  await page.getByText("Default saved for new registrations. Existing accounts keep their policy.", { exact: true }).waitFor();
  assert.deepEqual((await repository.betaControls!.getView()).settings.creditAllowance, { amount: 5, period: "week" });
  await page.getByLabel("Show remaining beta places on registration", { exact: true }).uncheck();
  await page.getByLabel("Reason for this change", { exact: true }).fill("Browser fixture hide remaining seats");
  await page.getByRole("button", { name: "Save beta limits", exact: true }).click();
  await page.getByText("Beta settings saved.", { exact: true }).waitFor();
  assert.equal((await repository.betaControls!.getView()).settings.showRegistrationRemaining, false);
  await screenshot("beta-controls");
  passed("Admin saves weekly default and seat visibility with reasons; existing-account transition remains separate");
  await page.goto(`${site}/admin/calls`);
  const audio = page.getByLabel("Include retained recordings from all associated attempts", { exact: true });
  await audio.waitFor(); assert(await audio.isChecked());
  await page.getByRole("button", { name: "Preview coverage and recordings", exact: true }).click();
  await page.getByText(/0 retained recordings · approximately/).waitFor();
  await audio.uncheck(); assert.equal(await audio.isChecked(), false);
  await screenshot("telemetry-preview");
  passed("Export audio defaults on, coverage preview works and metadata-only checkbox works");
  await context.clearCookies();
  for (const locale of uiLocales) {
    await page.goto(`${site}/${locale}/register`);
    await page.getByText(betaCreditMessages[locale].open, { exact: true }).waitFor();
    assert.equal(await page.getByText(betaPlacesText(30, locale), { exact: true }).count(), 0);
    await page.getByText(betaAllowanceText({ amount: 5, period: "week" }, locale), { exact: false }).waitFor();
  }
  passed("Hidden seat count and weekly allowance reflected in all seven public locales");
  assert.deepEqual(browserErrors, [], "Browser console/runtime errors");
  assert.deepEqual(httpErrors, [], "Unexpected HTTP errors");
  assert.equal(email.adminMessages.length, 0, "No email worker may run");
  await writeFile(new URL("results.json", output), JSON.stringify({ assertions, browserErrors, httpErrors, screenshots: "*.png", providers: "mock; no workers started" }, null, 2));
  console.log("All preproduction browser checks passed. Existing local services were untouched.");
  }
} catch (error) {
  if (page) {
    await page.screenshot({ path: fileURLToPath(new URL("failure.png", output)), fullPage: true }).catch(() => undefined);
    console.error("Browser failure evidence", JSON.stringify({ url: page.url(), browserErrors, httpErrors, requestsFailed, statusText: await page.locator('[role="status"]').allTextContents().catch(() => []) }));
  }
  throw error;
} finally {
  await browser?.close();
  if (next && next.exitCode === null) {
    if (process.platform === "win32") await new Promise(resolve => { const stop = spawn(`${process.env.SystemRoot ?? "C:/Windows"}/System32/taskkill.exe`, ["/pid", String(next.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); stop.on("exit", resolve); stop.on("error", resolve); });
    else next.kill("SIGTERM");
  }
  await app?.close();
  // Keep explicit ownership for failures before app construction as well. These
  // closes are idempotent when Fastify's hooks have already closed the services.
  await notifications?.close(); await reviews?.close(); await exports?.close();
  await service?.close(); await repository?.close(); await content?.repository.close(); await authRepository?.close();
  await sql?.end(); await database.teardown(); await log.close();
  if (next) {
    await writeFile(nextEnvPath, (await readFile(nextEnvPath, "utf8")).replace("./.next-preproduction-smoke/types/routes.d.ts", "./.next/types/routes.d.ts"));
    const tsconfig = JSON.parse(await readFile(tsconfigPath, "utf8"));
    tsconfig.include = tsconfig.include.filter((entry: string) => entry !== ".next-preproduction-smoke/types/**/*.ts");
    await writeFile(tsconfigPath, JSON.stringify(tsconfig, null, 2) + "\n");
  }
  console.log("Cleanup complete: owned servers closed, disposable database removed, Next type paths restored.");
}
