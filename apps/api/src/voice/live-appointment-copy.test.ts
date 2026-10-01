import { describe, expect, it } from "vitest";
import { appointmentRequestCopy, appointmentStatusCopy } from "./live-appointment-copy";
import { authorization, proposal } from "./voice-test-helpers";

describe("canonical appointment commitments", () => {
  it.each(["de-CH", "de-DE", "fr-CH", "it-CH", "ru-RU", "en-GB", "en-US"] as const)(
    "distinguishes booking from confirming an existing appointment in %s", locale => {
      const booking = appointmentRequestCopy(locale, "Nina Keller", authorization, { ...proposal, operation: "book" });
      const existing = appointmentRequestCopy(locale, "Nina Keller", { ...authorization, operation: "confirm_existing" },
        { ...proposal, operation: "confirm_existing" });
      const status = appointmentStatusCopy(locale, "Nina Keller", authorization, { ...proposal, operation: "book" });
      expect(booking).not.toBe(existing);
      expect(status).not.toBe(booking);
      for (const text of [booking, existing, status]) {
        expect(text).toContain("Nina Keller"); expect(text).toContain(authorization.serviceDescription);
        expect(text).toContain("2099"); expect(text).toContain("16");
        expect(text).toContain("15:00 (Europe/Zurich)");
        const weekdays = { "de-CH": "Mittwoch", "de-DE": "Mittwoch", "fr-CH": "mercredi", "it-CH": "mercoledì", "ru-RU": "среда", "en-GB": "Wednesday", "en-US": "Wednesday" };
        expect(text).toContain(weekdays[locale]);
      }
    });
});
