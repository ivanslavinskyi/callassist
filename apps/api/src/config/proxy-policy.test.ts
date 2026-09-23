import { afterEach, describe, expect, it } from "vitest";
import { apiHost, trustedProxyPolicy, twilioWebhookHost } from "./proxy-policy";
import { buildApp } from "../app";
import { CallService } from "../call-service";
import { InMemoryCallRepository } from "../storage/in-memory-call-repository";
import { InMemoryAuthRepository } from "../auth/in-memory-auth-repository";
import { AuthService } from "../auth/auth-service";
import { MockVerificationProvider } from "../auth/verification-provider";

const closers: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of closers.splice(0)) await close(); });

describe("explicit proxy trust", () => {
  it.each([undefined, "", "none"])("does not trust forwarding headers for %s", value => {
    expect(trustedProxyPolicy(value)).toBe(false);
  });
  it.each(["true", "false", "1", "*", "loopback", "uniquelocal", "0.0.0.0/0", "::/0", "127.0.0.1,", "127.0.0.1/33", "::1/129", "proxy.internal", "127.0.0.1/-1", "127.0.0.1/32/extra"])("rejects ambiguous or unsafe trust %s", value => {
    expect(() => trustedProxyPolicy(value)).toThrow("TRUSTED_PROXY_CIDRS");
  });
  it("accepts explicit IPv4 and IPv6 peers without broadening them", () => {
    expect(trustedProxyPolicy(" 172.30.0.2/32, ::1/128,172.30.0.2/32 ")).toEqual(["172.30.0.2/32", "::1/128"]);
    expect(twilioWebhookHost({})).toBe("127.0.0.1");
    expect(twilioWebhookHost({ TWILIO_WEBHOOK_HOST: "0.0.0.0" })).toBe("0.0.0.0");
    expect(() => twilioWebhookHost({ TWILIO_WEBHOOK_HOST: "https://calls.example" })).toThrow();
    expect(apiHost({ NODE_ENV: "production" })).toBe("127.0.0.1");
    expect(apiHost({ NODE_ENV: "development" })).toBe("0.0.0.0");
    expect(apiHost({ NODE_ENV: "production", API_HOST: "::1" })).toBe("::1");
    expect(() => apiHost({ NODE_ENV: "production", API_HOST: "api.local" })).toThrow("API_HOST");
  });
  it("uses the last untrusted address; direct callers cannot spoof forwarding headers", async () => {
    const app = buildApp({ service: new CallService(new InMemoryCallRepository()), logger: false, trustedProxyCidrs: "10.40.0.2/32" });
    app.get("/fixture/ip", request => ({ ip: request.ip }));
    closers.push(() => app.close());
    const trusted = await app.inject({ url: "/fixture/ip", remoteAddress: "10.40.0.2", headers: { "x-forwarded-for": "192.0.2.99, 198.51.100.10" } });
    expect(trusted.json()).toEqual({ ip: "198.51.100.10" });
    const direct = await app.inject({ url: "/fixture/ip", remoteAddress: "198.51.100.20", headers: { "x-forwarded-for": "192.0.2.99" } });
    expect(direct.json()).toEqual({ ip: "198.51.100.20" });
  });
  it("keeps registration limits independent for two clients behind the reviewed proxy", async () => {
    const repository = new InMemoryAuthRepository(), service = new CallService(new InMemoryCallRepository());
    const verification = new MockVerificationProvider();
    const authService = new AuthService({ repository, verificationProvider: verification, signupCreditGranter: service });
    const app = buildApp({ service, authService, logger: false, trustedProxyCidrs: "10.40.0.2/32" });
    closers.push(() => app.close());
    let account = 0;
    const register = (client: string, remoteAddress = "10.40.0.2") => {
      const sequence = ++account;
      return app.inject({ method: "POST", url: "/api/auth/register", remoteAddress,
        headers: { "x-forwarded-for": client }, payload: { email: `proxy-${sequence}@example.com`, password: "proxy-fixture-password",
          phoneE164: `+4179000${String(sequence).padStart(4, "0")}`, firstName: "Fictional", lastName: "Tester", uiLocale: "en" } });
    };
    for (let i = 0; i < 5; i++) expect((await register("198.51.100.10")).statusCode).toBe(202);
    expect((await register("192.0.2.123, 198.51.100.10")).statusCode).toBe(429);
    expect((await register("198.51.100.11")).statusCode).toBe(202);
    for (let i = 0; i < 5; i++) expect((await register(`192.0.2.${i+1}`, "198.51.100.20")).statusCode).toBe(202);
    expect((await register("192.0.2.88", "198.51.100.20")).statusCode).toBe(429);
    expect(verification.requests).toHaveLength(11);
  });
});
