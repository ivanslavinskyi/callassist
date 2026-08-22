import { describe, expect, it } from "vitest";
import {
  adminCallListFiltersSchema,
  adminCallSummarySchema,
  sensitiveCallAccessInputSchema
} from "./admin-calls";

describe("admin call contracts", () => {
  it("accepts deterministic operational filters and rejects inverted dates", () => {
    expect(adminCallListFiltersSchema.safeParse({
      status: "failed",
      outcome: "unresolved",
      consent: "failed",
      failureStage: "consent",
      locale: "de-CH",
      dateFrom: "2026-08-01T00:00:00.000Z",
      dateTo: "2026-08-31T23:59:59.999Z"
    }).success).toBe(true);
    expect(adminCallListFiltersSchema.safeParse({
      dateFrom: "2026-09-01T00:00:00.000Z",
      dateTo: "2026-08-01T00:00:00.000Z"
    }).success).toBe(false);
  });

  it("keeps list summaries free of call text, phone and comments", () => {
    const summary = adminCallSummarySchema.parse({
      id: "73000000-0000-4000-8000-000000000001",
      ownerUserId: "73000000-0000-4000-8000-000000000002",
      status: "completed",
      locale: "de-CH",
      createdAt: "2026-08-22T12:00:00.000Z",
      updatedAt: "2026-08-22T12:05:00.000Z",
      technical: {
        connection: "confirmed",
        terminalStatus: "completed",
        consent: "granted",
        recording: "completed",
        transcription: "completed",
        failureStage: null,
        failureCode: null
      },
      semanticOutcome: "resolved",
      outcomeProvenance: "user",
      feedback: {
        revision: 1,
        goalResult: "yes",
        transcriptQuality: "good",
        createdAt: "2026-08-22T12:06:00.000Z"
      },
      durationSeconds: 180,
      eventCount: 14
    });
    expect(summary).not.toHaveProperty("phoneNumber");
    expect(summary).not.toHaveProperty("recipientName");
    expect(summary).not.toHaveProperty("objective");
    expect(summary.feedback).not.toHaveProperty("comment");
  });

  it("requires a bounded operational reason for sensitive access", () => {
    expect(sensitiveCallAccessInputSchema.safeParse({
      reason: "Investigating support ticket 123"
    }).success).toBe(true);
    expect(sensitiveCallAccessInputSchema.safeParse({ reason: "x" }).success)
      .toBe(false);
    expect(sensitiveCallAccessInputSchema.safeParse({
      reason: "x".repeat(501)
    }).success).toBe(false);
  });
});
