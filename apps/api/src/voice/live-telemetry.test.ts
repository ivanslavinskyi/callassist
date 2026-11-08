import { describe, expect, it, vi } from "vitest";
import { LiveTelemetry } from "./live-telemetry";

const event = { name: "conversation.started", metadata: {} } as const;
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

describe("optional Live telemetry", () => {
  it("bounds pending work while storage is hung, then drains in order", async () => {
    let release!: () => void;
    const write = vi.fn<(_key: string) => Promise<void>>()
      .mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockResolvedValue(undefined);
    const warn = vi.fn(); const telemetry = new LiveTelemetry(write, warn);
    for (let i = 0; i < 100; i++) telemetry.record(String(i), event);
    expect(write).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ reason: "queue_full", dropped: 1 }));
    expect(warn.mock.calls.length).toBeLessThan(10);
    release(); await flush();
    expect(write.mock.calls.map(([key]) => key)).toEqual(Array.from({ length: 64 }, (_, i) => String(i)));
    telemetry.record("recovered", event); await flush();
    expect(write).toHaveBeenLastCalledWith("recovered", event);
  });
  it("continues after rejected and synchronously thrown writes without leaking errors", async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error("PRIVATE_ERROR"))
      .mockImplementationOnce(() => { throw new Error("PRIVATE_THROW"); }).mockResolvedValue(undefined);
    const warn = vi.fn(); const telemetry = new LiveTelemetry(write, warn);
    telemetry.record("one", event); telemetry.record("two", event); telemetry.record("three", event);
    await flush();
    expect(write).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenLastCalledWith({ code: "LIVE_TELEMETRY_UNAVAILABLE", reason: "write_failed", failed: 2, dropped: 0 });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("PRIVATE");
  });
  it("survives a failed diagnostic logger and still attempts subsequent writes", async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error("storage")).mockResolvedValue(undefined);
    const telemetry = new LiveTelemetry(write, () => { throw new Error("logger"); });
    telemetry.record("one", event); telemetry.record("two", event); await flush();
    expect(write).toHaveBeenCalledTimes(2);
  });
});
