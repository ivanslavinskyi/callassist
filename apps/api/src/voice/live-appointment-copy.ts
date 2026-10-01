import type { AppointmentAuthorization, CallLocale } from "@callassist/contracts";
import { calendarDateDetails } from "@callassist/contracts";
import type { AppointmentProposal } from "../realtime/appointment-authorization";

/** Only validated appointment data enters this commitment; no model-authored claims. */
export function appointmentRequestCopy(locale: CallLocale, person: string,
  authorization: AppointmentAuthorization, proposal: AppointmentProposal): string {
  const date = calendarDateDetails(proposal.date, locale).dateLabel;
  const details = `${authorization.serviceDescription}, ${date}, ${proposal.startTime} (${proposal.timeZone})`;
  const confirm = authorization.operation === "confirm_existing";
  switch (locale) {
    case "de-CH": case "de-DE": return confirm
      ? `Bitte bestätigen Sie, ob für ${person} bereits folgender Termin besteht: ${details}.`
      : `Bitte tragen Sie für ${person} folgenden Termin ein und bestätigen Sie die Buchung: ${details}.`;
    case "fr-CH": return confirm
      ? `Pouvez-vous confirmer que ${person} a déjà ce rendez-vous : ${details} ?`
      : `Veuillez réserver pour ${person} ce rendez-vous et confirmer la réservation : ${details}.`;
    case "it-CH": return confirm
      ? `Può confermare se ${person} ha già questo appuntamento: ${details}?`
      : `Per favore, prenoti per ${person} questo appuntamento e confermi la prenotazione: ${details}.`;
    case "ru-RU": return confirm
      ? `Подтвердите, пожалуйста, есть ли уже у ${person} такая запись: ${details}?`
      : `Оформите, пожалуйста, для ${person} запись и подтвердите её: ${details}.`;
    case "en-GB": case "en-US": return confirm
      ? `Please confirm whether ${person} already has this appointment: ${details}.`
      : `Please book this appointment for ${person} and confirm the booking: ${details}.`;
  }
}

/** Reconcile the existing arrangement only; this is never another booking request. */
export function appointmentStatusCopy(locale: CallLocale, person: string,
  authorization: AppointmentAuthorization, proposal: AppointmentProposal): string {
  const details = `${authorization.serviceDescription}, ${calendarDateDetails(proposal.date, locale).dateLabel}, ${proposal.startTime} (${proposal.timeZone})`;
  switch (locale) {
    case "de-CH": case "de-DE": return `Bitte prüfen Sie nur den Status dieses Termins für ${person}: ${details}. Ist er bereits gebucht? Bitte keinen weiteren Termin anlegen.`;
    case "fr-CH": return `Veuillez vérifier uniquement le statut de ce rendez-vous pour ${person} : ${details}. Est-il déjà réservé ? Ne créez pas de deuxième réservation.`;
    case "it-CH": return `Verifichi soltanto lo stato di questo appuntamento per ${person}: ${details}. È già prenotato? Non crei un secondo appuntamento.`;
    case "ru-RU": return `Уточните, пожалуйста, только статус этой записи для ${person}: ${details}. Она уже оформлена? Не создавайте вторую запись.`;
    case "en-GB": case "en-US": return `Please check only the status of this appointment for ${person}: ${details}. Is it already booked? Do not create another booking.`;
  }
}
