import type { UiLocale } from "@callassist/contracts";

/** Recipient reports and the application's verified action state are different facts. */
export const appointmentResultMessages: Record<UiLocale, { unresolved: string; confirmed: string }> = {
  en: { unresolved: "The appointment outcome remains uncertain. A spoken report of booking does not replace confirmation of the exact arrangement.", confirmed: "The recipient confirmed the exact appointment. No external calendar was verified." },
  de: { unresolved: "Das Ergebnis der Terminvereinbarung bleibt ungewiss. Eine mündliche Buchungsmeldung ersetzt nicht die Bestätigung des genauen Termins.", confirmed: "Die angerufene Person hat den genauen Termin bestätigt. Ein externer Kalender wurde nicht überprüft." },
  fr: { unresolved: "Le résultat de la prise de rendez-vous reste incertain. Une déclaration orale de réservation ne remplace pas la confirmation du rendez-vous exact.", confirmed: "La personne appelée a confirmé le rendez-vous exact. Aucun calendrier externe n’a été vérifié." },
  it: { unresolved: "L’esito della prenotazione rimane incerto. Una dichiarazione verbale di prenotazione non sostituisce la conferma dell’appuntamento esatto.", confirmed: "La persona chiamata ha confermato l’appuntamento esatto. Nessun calendario esterno è stato verificato." },
  rm: { unresolved: "Il resultat da la reservaziun dal termin resta malsegir. Ina communicaziun orala da reservaziun na remplazza betg la conferma dal termin exact.", confirmed: "La persuna telefonada ha confermà il termin exact. Nagina agenda externa n’è vegnida verifitgada." },
  ru: { unresolved: "Результат записи остаётся неопределённым. Сообщение собеседника о записи не заменяет подтверждение точной договорённости.", confirmed: "Собеседник подтвердил точную запись. Во внешнем календаре она не проверялась." },
  uk: { unresolved: "Результат запису залишається невизначеним. Повідомлення співрозмовника про запис не замінює підтвердження точної домовленості.", confirmed: "Співрозмовник підтвердив точний запис. У зовнішньому календарі його не перевіряли." }
};
