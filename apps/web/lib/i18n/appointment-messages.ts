import type { UiLocale } from "./messages";

export const appointmentMessages = {
  en: {
    title: "Appointment or meeting permission",
    operation: { book: "Arrange one appointment or meeting", confirm_existing: "Confirm one existing appointment or meeting" },
    scope: "Only with the recipient of this call.",
    windows: "Permitted start times",
    inclusive: "A start time may equal either end of a time window.",
    timeZone: "Time zone",
    selection: {
      book: "Choose the first offered time that matches these limits. At most one appointment.",
      confirm_existing: "Confirm attendance only for this appointment or meeting as arranged. Do not arrange another."
    },
    financialPolicy: "Do not accept new charges, deposits, cancellation fees or other financial terms."
  },
  de: {
    title: "Terminfreigabe",
    operation: { book: "Einen Termin vereinbaren", confirm_existing: "Einen bestehenden Termin bestätigen" },
    scope: "Nur mit der angerufenen Person oder Stelle.",
    windows: "Erlaubte Startzeiten",
    inclusive: "Die Startzeit darf auch auf einer der beiden Grenzen eines Zeitfensters liegen.",
    timeZone: "Zeitzone",
    selection: {
      book: "Den ersten angebotenen Termin wählen, der diese Grenzen einhält. Höchstens ein Termin.",
      confirm_existing: "Nur die Teilnahme an diesem bestehenden Termin bestätigen. Keinen neuen Termin buchen."
    },
    financialPolicy: "Keine neuen Kosten, Anzahlungen, Stornogebühren oder sonstigen finanziellen Bedingungen akzeptieren."
  }
} satisfies Record<UiLocale, {
  title: string;
  operation: Record<"book" | "confirm_existing", string>;
  scope: string; windows: string; inclusive: string; timeZone: string;
  selection: Record<"book" | "confirm_existing", string>; financialPolicy: string;
}>;
