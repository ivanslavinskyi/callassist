import { extendMessages } from "./extend-messages";

export const clinicPreparationMessages = extendMessages({
  en: {
    title: "Booking at a clinic? Optional details",
    intro: "You can add these details to the approved information below, one fact per line:",
    dateOfBirth: "Date of birth, if you authorize sharing it.",
    previousVisit: "Whether the person you represent has visited this clinic before.",
    choices: "Both are optional. You can write “unknown” or “do not share” for each item, or leave it out.",
    review: "Only include what you authorize for this call. Do not add medical details unrelated to the booking. Review the prepared plan before approving it."
  },
  de: {
    title: "Termin in einer Praxis? Freiwillige Angaben",
    intro: "Sie können diese Angaben unten bei den freigegebenen Informationen ergänzen, eine Angabe pro Zeile:",
    dateOfBirth: "Geburtsdatum, wenn Sie die Weitergabe erlauben.",
    previousVisit: "Ob die vertretene Person schon einmal in dieser Praxis war.",
    choices: "Beides ist freiwillig. Sie können für jede Angabe «unbekannt» oder «nicht weitergeben» schreiben oder sie weglassen.",
    review: "Geben Sie nur an, was Sie für diesen Anruf freigeben. Ergänzen Sie keine medizinischen Details, die für die Terminvereinbarung nicht relevant sind. Prüfen Sie den vorbereiteten Plan, bevor Sie ihn freigeben."
  }
});
