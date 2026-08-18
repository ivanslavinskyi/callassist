import { describe, expect, it } from "vitest";
import { isTerminalCallStatus } from "./call-status";

describe("terminal call status", () => {
  it.each(["completed", "stopped", "failed"] as const)(
    "treats %s as terminal",
    (status) => expect(isTerminalCallStatus(status)).toBe(true)
  );

  it.each(["review_required", "ready", "dialing", "in_progress"] as const)(
    "keeps actions available for %s",
    (status) => expect(isTerminalCallStatus(status)).toBe(false)
  );
});
