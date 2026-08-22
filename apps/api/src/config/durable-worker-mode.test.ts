import { describe, expect, it } from "vitest";
import { durableWorkerModeFromEnv } from "./durable-worker-mode";

describe("durable worker mode", () => {
  it("defaults to embedded processing for local compatibility", () => {
    expect(durableWorkerModeFromEnv(undefined)).toBe("embedded");
    expect(durableWorkerModeFromEnv("  ")).toBe("embedded");
  });

  it("accepts only the explicit split-runtime mode", () => {
    expect(durableWorkerModeFromEnv(" external ")).toBe("external");
    expect(() => durableWorkerModeFromEnv("disabled")).toThrow(
      "DURABLE_WORKER_MODE must be embedded or external"
    );
  });
});
