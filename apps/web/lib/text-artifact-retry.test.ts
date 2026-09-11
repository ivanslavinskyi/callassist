import { expect, it } from "vitest";
import type { CallTextArtifact } from "@callassist/contracts";
import { canRequestTextArtifact } from "./text-artifact-retry";

it("offers generation only for missing artifacts or server-authorized failed retries", () => {
  expect(canRequestTextArtifact(null)).toBe(true);
  for (const status of ["queued", "processing", "ready", "stale", "cancelled"] as const) {
    expect(canRequestTextArtifact({ status, retryable: false } as CallTextArtifact)).toBe(false);
  }
  expect(canRequestTextArtifact({ status: "failed", retryable: false } as CallTextArtifact)).toBe(false);
  expect(canRequestTextArtifact({ status: "failed", retryable: true } as CallTextArtifact)).toBe(true);
});
