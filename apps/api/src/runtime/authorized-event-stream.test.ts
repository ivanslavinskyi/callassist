import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { createAuthorizedEventStream } from "./authorized-event-stream";

afterEach(() => vi.useRealTimers());

it.each(["unavailable", "timeout", "backpressure"])("closes and unsubscribes on %s", async (mode) => {
  vi.useFakeTimers();
  const response = Object.assign(new EventEmitter(), {
    destroyed: false, writableEnded: false,
    write: vi.fn(() => mode !== "backpressure"), destroy: vi.fn()
  });
  const unsubscribe = vi.fn();
  createAuthorizedEventStream({
    response: response as unknown as ServerResponse,
    initial: { secret: "fixture" }, subscribe: () => unsubscribe,
    authorize: mode === "unavailable" ? async () => { throw new Error("database offline"); }
      : mode === "timeout" ? () => new Promise<boolean>(() => {}) : async () => true
  });
  await vi.advanceTimersByTimeAsync(2_001);
  expect(response.destroy).toHaveBeenCalledOnce();
  expect(unsubscribe).toHaveBeenCalledOnce();
  if (mode !== "backpressure") expect(response.write).not.toHaveBeenCalled();
});
