import { describe, expect, it, vi } from "vitest";
import { createGracefulShutdown } from "./graceful-shutdown";

describe("graceful runtime shutdown", () => {
  it("shares one close operation across repeated termination requests", async () => {
    let release!: () => void;
    const close = vi.fn(() => new Promise<void>((resolve) => {
      release = resolve;
    }));
    const shutdown = createGracefulShutdown(close);

    const first = shutdown();
    const second = shutdown();
    expect(close).toHaveBeenCalledOnce();
    expect(second).toBe(first);

    release();
    await expect(first).resolves.toBeUndefined();
  });
});
