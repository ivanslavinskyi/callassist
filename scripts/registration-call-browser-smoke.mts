/** Local-only browser integration. Uses an isolated test database and mock providers.
 * Run with the API tsx loader. PLAYWRIGHT_MODULE_PATH can point to playwright/index.mjs.
 * Requires Chromium installed for Playwright; never sends SMS/email or dials Twilio.
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
import { AuthService } from "../apps/api/src/auth/auth-service.ts";
import { MockVerificationProvider } from "../apps/api/src/auth/verification-provider.ts";
import { CallService } from "../apps/api/src/call-service.ts";
import { DeterministicBriefCompiler } from "../apps/api/src/brief-compiler/brief-compiler.ts";
import { buildApp } from "../apps/api/src/app.ts";
import { originalPlanReview } from "../apps/api/src/test-helpers/original-plan-review.ts";

const apiRequire = createRequire(new URL("../apps/api/package.json", import.meta.url));
const webRequire = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { default: postgres } = await import(pathToFileURL(apiRequire.resolve("postgres")).href);
const { defaultBetaSettings } = await import(pathToFileURL(apiRequire.resolve("@callassist/contracts")).href);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const apiPort = Number(process.env.SMOKE_API_PORT ?? 4311);
const webPort = Number(process.env.SMOKE_WEB_PORT ?? 3311);
const site = `http://127.0.0.1:${webPort}`;
const apiUrl = `http://127.0.0.1:${apiPort}`;
const output = new URL("../.tools/registration-smoke/", import.meta.url);
await mkdir(output, { recursive: true });
const log = await open(new URL("next.log", output), "w");
const nextEnvPath = new URL("../apps/web/next-env.d.ts", import.meta.url);
const tsconfigPath = new URL("../apps/web/tsconfig.json", import.meta.url);
const database = isolatedTestDatabase();
let sql, authRepository, content, app, next, browser;
let compilerCalls = 0;
try {
  await database.setup();
  sql = postgres(database.url, { max: 3 });
  authRepository = new PostgresAuthRepository(database.url, true);
  const repository = new PostgresCallRepository(database.url, Buffer.alloc(32, 17), true);
  const compiler = new DeterministicBriefCompiler();
  const service = new CallService(repository, undefined, undefined, undefined, { compile: (...args) => { compilerCalls++; return compiler.compile(...args); } }, undefined, undefined, { durableWorkerEnabled: false });
  content = new ContentService(new PostgresContentRepository(database.url));
  await content.initialize();
  const auth = new AuthService({ repository: authRepository, signupCreditGranter: service, verificationProvider: new MockVerificationProvider("123456"), emailVerificationCode: () => "123456" });
  await sql`UPDATE beta_controls SET settings=${sql.json({ ...defaultBetaSettings, registration: { onboarding: "registration", emailVerification: "deferrable" }, rollingDayBudgetMicros: 100_000_000 })} WHERE id=true`;
  app = buildApp({ service, authService: auth, contentService: content, logger: false, secureCookies: false, webOrigin: site, trustedProxyCidrs: "none" });
  await app.listen({ host: "127.0.0.1", port: apiPort });
  next = spawn(process.execPath, [webRequire.resolve("next/dist/bin/next"), "dev", "--port", String(webPort), "--hostname", "127.0.0.1"], {
    cwd: `${root}apps/web`, windowsHide: true, stdio: ["ignore", log.fd, log.fd],
    env: { ...process.env, NODE_ENV: "development", NEXT_DIST_DIR: ".next-registration-smoke", NEXT_PUBLIC_API_URL: apiUrl, INTERNAL_API_URL: apiUrl, NEXT_PUBLIC_SITE_URL: site }
  });
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    try { if ((await fetch(`${site}/en/register`)).ok) { ready = true; break; } } catch {}
    if (next.exitCode !== null) throw new Error("Next exited before readiness; inspect .tools/registration-smoke/next.log");
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert(ready, "Next did not become ready");
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}) });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  const errors: string[] = [];
  page.on("pageerror", error => { errors.push(error.message); console.error("Browser error:", error.message); });
  page.on("requestfailed", request => console.error("Browser request failed:", new URL(request.url()).pathname, request.failure()?.errorText));
  page.on("response", response => { if (response.status() >= 400) console.error("Browser HTTP error:", response.status(), new URL(response.url()).pathname); });
  for (const locale of ["de", "fr", "it", "rm", "en", "ru", "uk"]) {
    await page.goto(`${site}/${locale}/register`);
    await page.locator('input[name="legalAgreement"]').waitFor();
    if (await page.locator(".privacy-notice button").isVisible()) await page.locator(".privacy-notice button").click();
    assert.equal(await page.locator(".registration-documents a").count(), 3);
    assert.equal(await page.locator('input[name="legalAgreement"]').isChecked(), false);
    await page.locator('input[type="tel"]').fill("410790000001");
    assert.equal(await page.locator('input[name="phoneE164"]').inputValue(), "+41790000001");
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${locale}: horizontal overflow at ${width}`);
    }
    await page.screenshot({ path: fileURLToPath(new URL(`register-${locale}.png`, output)), fullPage: true });
  }
  console.log("PASS: registration documents, phone normalization and mobile layout in seven locales");
  await page.goto(`${site}/en/register`);
  const email = `browser-${randomUUID()}@example.com`;
  await page.locator('[name="firstName"]').fill("Browser");
  await page.locator('[name="lastName"]').fill("Tester");
  await page.locator('[name="email"]').fill(email);
  await page.locator('input[type="tel"]').fill("0790000001");
  await page.locator('[name="password"]').fill("Browser-test-password-2026");
  await page.locator('[name="legalAgreement"]').check();
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(/\/en\/verify\?/);
  await page.locator('[name="code"]').fill("123456");
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(/\/en\/verify-email$/);
  await page.getByRole("button", { name: "Confirm later", exact: true }).waitFor();
  await page.locator('form button[type="submit"]').click();
  await page.locator('input[autocomplete="one-time-code"]').waitFor();
  await page.getByRole("button", { name: "Confirm later", exact: true }).click();
  await page.waitForURL(`${site}/en/app`);
  const owner = await authRepository.findUserByEmail(email);
  assert(owner?.emailVerificationDeferredAt);
  assert.equal(owner.emailVerifiedAt, null);
  assert.equal((await content.getOnboardingStatus(owner.id, "en")).required, false);
  console.log("PASS: registration → SMS → email screen → send code → defer → new call");
  await context.clearCookies();
  await page.goto(`${site}/en/login`);
  await page.locator('[name="email"]').fill(email);
  await page.locator('[name="password"]').fill("Browser-test-password-2026");
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(`${site}/en/app`);
  console.log("PASS: deferred email remains unverified and survives a new login");
  const source = await service.create({ recipientName: "Browser Test Office", phoneNumber: "+41523686688", objective: "Ask when the office opens tomorrow", assistantProfileId: "sebastian", representedPersonFirstName: "Browser", representedPersonLastName: "Tester", locale: "en-GB", allowedFacts: [] }, owner.id);
  await repository.approveCompilation(source.id, await originalPlanReview(repository, source.id));
  const attempt = await repository.startAttempt(source.id, { provider: "twilio", userId: owner.id });
  await repository.attachProviderCall(attempt.attempt.id, "CA-browser-test", "queued");
  await repository.applyProviderStatus("CA-browser-test", "no-answer", "failed", source.id);
  await page.goto(`${site}/en/app/calls/${source.id}`);
  await page.getByRole("button", { name: "Repeat call", exact: true }).waitFor();
  assert.equal(await page.locator(".call-page-links a").count(), 2);
  await page.locator('input[name="goal-result"][value="no"]').check();
  await page.locator("#call-feedback textarea").fill("Useful call history");
  const feedbackKeys: string[] = [];
  await page.route("**/api/call-briefs/*/feedback", async route => {
    feedbackKeys.push(route.request().postDataJSON().idempotencyKey);
    if (feedbackKeys.length === 1) {
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      return route.abort("failed"); // The server committed; simulate a lost response.
    }
    return route.continue();
  });
  await page.locator('#call-feedback button[type="submit"]').click();
  await page.waitForFunction(() => Boolean(document.querySelector("#call-feedback .feedback-error")?.textContent));
  assert.equal(await page.locator("#call-feedback textarea").inputValue(), "Useful call history");
  await page.locator('#call-feedback button[type="submit"]').click();
  await page.getByRole("button", { name: "Edit feedback", exact: true }).waitFor();
  assert.equal(feedbackKeys.length, 2);
  assert.equal(feedbackKeys[0], feedbackKeys[1]);
  await page.unroute("**/api/call-briefs/*/feedback");
  assert.equal(await page.locator("#call-feedback form").count(), 0);
  await page.reload();
  await page.getByRole("button", { name: "Edit feedback", exact: true }).click();
  await page.locator("#call-feedback textarea").fill("Discard this draft");
  await page.locator("#call-feedback").getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await page.locator(".feedback-saved-comment").innerText(), "Useful call history");
  await page.getByRole("button", { name: "Edit feedback", exact: true }).click();
  await page.locator("#call-feedback textarea").fill("Updated feedback");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("button", { name: "Edit feedback", exact: true }).waitFor();
  console.log("PASS: feedback lost-response retry, read-only after reload, edit, cancel and revision save");
  const before = compilerCalls;
  await page.getByRole("button", { name: "Repeat call", exact: true }).click();
  await page.waitForURL(url => url.pathname.startsWith("/en/app/calls/") && !url.pathname.endsWith(source.id));
  await page.locator(".compilation-review").waitFor();
  const repeatedId = new URL(page.url()).pathname.split("/").at(-1)!;
  assert.equal(compilerCalls, before);
  assert.equal((await repository.get(repeatedId))?.brief.retrySourceCallId, source.id);
  assert.equal((await repository.get(repeatedId))?.compilation?.approvedAt, null);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.locator('form.call-form button[type="submit"]').click();
  await page.locator(".compilation-review").waitFor();
  assert.equal(compilerCalls, before, "An unchanged edit must reuse the compilation");
  assert.equal(await page.locator(".call-page-links a").first().isVisible(), true);
  await page.screenshot({ path: fileURLToPath(new URL("repeat-review-mobile.png", output)), fullPage: true });
  await page.goto(`${site}/en/app/history`);
  await page.locator(".brief-objective").first().waitFor();
  assert((await page.locator(".brief-objective").allTextContents()).every(text => text.includes("Ask when the office opens tomorrow")));
  assert.equal(compilerCalls, before);
  console.log("PASS: repeat → fresh review and history objective, no extra compilation");
  assert.deepEqual(errors, [], "Browser runtime errors");
  console.log("All local browser checks passed. No real provider requests were made.");
} finally {
  await browser?.close();
  if (next && next.exitCode === null) {
    if (process.platform === "win32") await new Promise(resolve => { const stop = spawn(`${process.env.SystemRoot ?? "C:/Windows"}/System32/taskkill.exe`, ["/pid", String(next.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); stop.on("exit", resolve); stop.on("error", resolve); });
    else next.kill("SIGTERM");
  }
  await app?.close();
  await content?.repository.close();
  await authRepository?.close();
  await sql?.end();
  await database.teardown();
  await log.close();
  // Next dev generates type paths for its isolated distDir. Remove only our own paths.
  await writeFile(nextEnvPath, (await readFile(nextEnvPath, "utf8")).replace("./.next-registration-smoke/types/routes.d.ts", "./.next/types/routes.d.ts"));
  const tsconfig = JSON.parse(await readFile(tsconfigPath, "utf8"));
  tsconfig.include = tsconfig.include.filter((entry: string) => entry !== ".next-registration-smoke/types/**/*.ts");
  await writeFile(tsconfigPath, JSON.stringify(tsconfig, null, 2) + "\n");
}
