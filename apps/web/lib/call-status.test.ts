import { describe, expect, it } from "vitest";
import { isTerminalCallStatus, callStatusLabel, callStatusClass, callResultLabel } from "./call-status";
import { deriveCallLifecycle } from "@callassist/contracts";
import { messages } from "./i18n/messages";

describe("terminal call status", () => {
  it("uses neutral legacy completion and the same distinct results in EN and DE", () => {
    for (const locale of ["en", "de"] as const) {
      expect(callStatusLabel({ status: "completed" }, locale)).toBe(locale === "de" ? "Anruf beendet" : "Call ended");
      const lifecycle = { ...deriveCallLifecycle("failed", []), result: "no_answer" as const };
      expect(callStatusLabel({ status: "failed", lifecycle }, locale)).toBe(messages[locale].live.status.completed);
      expect(callResultLabel({ status: "failed", lifecycle }, locale)).toBe(locale === "de" ? "Nicht abgenommen" : "No answer");
      expect(callStatusClass({ status: "completed" })).toBe("status-ended");
      expect(messages[locale].dashboard.status).toEqual(messages[locale].live.status);
      expect(callStatusLabel({ status: "review_required" }, locale)).not.toBe(callStatusLabel({ status: "ready" }, locale));
    }
  });
  it.each(["completed", "stopped", "failed"] as const)(
    "treats %s as terminal",
    (status) => expect(isTerminalCallStatus(status)).toBe(true)
  );

  it.each(["review_required", "ready", "dialing", "in_progress"] as const)(
    "keeps actions available for %s",
    (status) => expect(isTerminalCallStatus(status)).toBe(false)
  );
});
