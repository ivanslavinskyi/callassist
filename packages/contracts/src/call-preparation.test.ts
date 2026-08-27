import { describe, expect, it } from "vitest";
import { callPreparationSchema } from "./call-preparation";

const base = {
  id: "00000000-0000-4000-8000-000000000001",
  attemptCount: 0,
  createdAt: "2026-08-27T12:00:00.000Z",
  updatedAt: "2026-08-27T12:00:00.000Z"
};

describe("call preparation contract", () => {
  it("accepts active and succeeded owner views", () => {
    expect(callPreparationSchema.parse({
      ...base,
      status: "queued",
      callBriefId: null,
      failureCode: null,
      completedAt: null
    }).status).toBe("queued");
    expect(callPreparationSchema.parse({
      ...base,
      status: "succeeded",
      callBriefId: "00000000-0000-4000-8000-000000000002",
      failureCode: null,
      completedAt: "2026-08-27T12:00:10.000Z"
    }).status).toBe("succeeded");
  });

  it("rejects inconsistent terminal state", () => {
    expect(callPreparationSchema.safeParse({
      ...base,
      status: "failed",
      callBriefId: null,
      failureCode: null,
      completedAt: "2026-08-27T12:00:10.000Z"
    }).success).toBe(false);
    expect(callPreparationSchema.safeParse({
      ...base,
      status: "processing",
      callBriefId: "00000000-0000-4000-8000-000000000002",
      failureCode: null,
      completedAt: null
    }).success).toBe(false);
  });
});
