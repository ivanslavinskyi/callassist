import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const accountConsole = readFileSync(fileURLToPath(
  new URL("../components/account-console.tsx", import.meta.url)
), "utf8");
const phoneInput = readFileSync(fileURLToPath(new URL("../components/phone-input.tsx", import.meta.url)), "utf8");

describe("account contact-change form semantics", () => {
  it("gives password managers an explicit current username before phone and password", () => {
    const form = accountConsole.slice(
      accountConsole.indexOf('name="change-mobile"'),
      accountConsole.indexOf('name="change-mobile"') + 3_000
    );
    expect(form).toContain('autoComplete="username"');
    expect(form).toContain('name="username"');
    expect(form).toContain('inputId="new-mobile"');
    expect(form).toContain('name="newPhoneE164"');
    expect(phoneInput).toContain('id={inputId}');
    expect(phoneInput).toContain('autoComplete="tel"');
    expect(form).toContain('id="change-mobile-current-password"');
    expect(form.indexOf('autoComplete="username"'))
      .toBeLessThan(form.indexOf('inputId="new-mobile"'));
    expect(form.indexOf('inputId="new-mobile"'))
      .toBeLessThan(form.indexOf('autoComplete="current-password"'));
  });

  it("keeps current and proposed email inputs distinct", () => {
    const form = accountConsole.slice(
      accountConsole.indexOf('name="change-email"'),
      accountConsole.indexOf('name="change-email"') + 2_500
    );
    expect(form).toContain('id="change-email-username"');
    expect(form).toContain('name="username"');
    expect(form).toContain('id="new-email"');
    expect(form).toContain('name="newEmail"');
    expect(form).toContain('id="change-email-current-password"');
  });
});
