import Fastify, { LogController } from "fastify";
import { describe, expect, it } from "vitest";
import {
  piiSafeLoggerOptions,
  registerPiiSafeRequestLogging,
  safeErrorForLog,
  safeRequestForLog
} from "./pii-safe-logger";

describe("PII-safe runtime logging", () => {
  it("preserves a bounded database cause without logging SQL, parameters or private text", () => {
    const cause = Object.assign(new Error("private account in query"), { code: "40P01", query: "private SQL", parameters: ["secret"] });
    const error = Object.assign(new Error("private envelope", { cause }), { code: "BRIEF_COMPILATION_FAILED" });
    const safe = safeErrorForLog(error);
    expect(safe).toMatchObject({ code: "BRIEF_COMPILATION_FAILED", cause: { code: "DATABASE_DEADLOCK" } });
    expect(JSON.stringify(safe)).not.toMatch(/private|secret|parameters/);
  });
  it("serializes the route template instead of the raw URL", () => {
    expect(safeRequestForLog({
      id: "req-1",
      method: "GET",
      routeOptions: { url: "/api/call-briefs/:id" },
      url: "/api/call-briefs/private-id?token=private"
    } as never)).toEqual({
      requestId: "req-1",
      method: "GET",
      route: "/api/call-briefs/:id"
    });
  });

  it("drops arbitrary exception messages and stacks", () => {
    const error = Object.assign(
      new Error("phone +41760000000 and postgres://private"),
      { code: "DATABASE_UNAVAILABLE", statusCode: 503 }
    );

    expect(safeErrorForLog(error)).toEqual({
      type: "Error",
      message: "[Redacted]",
      stack: "[Redacted]",
      code: "DATABASE_UNAVAILABLE",
      statusCode: 503
    });
    expect(JSON.stringify(safeErrorForLog(error))).not.toContain("private");
  });

  it("redacts known identity, content, credential and provider-id fields", () => {
    const paths = piiSafeLoggerOptions.redact.paths;
    expect(paths).toEqual(expect.arrayContaining([
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers.x-twilio-signature",
      "phoneNumber",
      "email",
      "objective",
      "transcript",
      "providerCallId",
      "recordingId"
    ]));
  });

  it("does not leak raw URL, credentials or exception messages in live logs", async () => {
    const output: string[] = [];
    const app = Fastify({
      logger: {
        ...piiSafeLoggerOptions,
        stream: { write: (chunk: string) => output.push(chunk) }
      },
      logController: new LogController({ disableRequestLogging: true })
    });
    registerPiiSafeRequestLogging(app);
    app.get("/fail/:id", async () => {
      throw new Error("phone +41760000000 and postgres://private");
    });

    await app.inject({
      method: "GET",
      url: "/fail/private-id?token=secret",
      headers: { authorization: "Bearer private" }
    });
    await app.close();

    const logs = output.join("");
    expect(logs).toContain('"route":"/fail/:id"');
    expect(logs).toContain('"msg":"request failed"');
    expect(logs).not.toContain("private-id");
    expect(logs).not.toContain("+41760000000");
    expect(logs).not.toContain("postgres://");
    expect(logs).not.toContain("Bearer");
  });
});
