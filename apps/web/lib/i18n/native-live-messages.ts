import type { UiLocale } from "./messages";

export const nativeRecordingCopy: Record<UiLocale, { basis: string; completed: string; unanswered: string }> = {
  en: { basis: "Recording with a notice", completed: "A substantive answer was confirmed. This does not by itself mean the task was resolved.", unanswered: "No substantive answer to the task was confirmed." },
  de: { basis: "Aufzeichnung mit Hinweis", completed: "Eine inhaltliche Antwort wurde bestätigt. Das bedeutet nicht automatisch, dass die Aufgabe gelöst wurde.", unanswered: "Es wurde keine inhaltliche Antwort zur Aufgabe bestätigt." },
  fr: { basis: "Enregistrement avec information préalable", completed: "Une réponse pertinente a été confirmée. Cela ne signifie pas à lui seul que la tâche a été résolue.", unanswered: "Aucune réponse pertinente à la tâche n’a été confirmée." },
  it: { basis: "Registrazione con avviso", completed: "È stata confermata una risposta pertinente. Questo non significa di per sé che il compito sia stato risolto.", unanswered: "Non è stata confermata alcuna risposta pertinente al compito." },
  rm: { basis: "Registraziun cun avis", completed: "Ina resposta substanziala è vegnida confermada. Quai na signifitga betg automaticamain che l’incumbensa saja schliada.", unanswered: "Nagina resposta substanziala a l’incumbensa n’è vegnida confermada." },
  ru: { basis: "Запись с уведомлением", completed: "Подтверждён содержательный ответ. Само по себе это не означает, что задача решена.", unanswered: "Содержательный ответ на задачу не подтверждён." },
  uk: { basis: "Запис із повідомленням", completed: "Підтверджено змістовну відповідь. Саме по собі це не означає, що завдання вирішено.", unanswered: "Змістовну відповідь на завдання не підтверджено." }
};

const copy: Record<UiLocale, readonly [string, string, string]> = {
  "en": [
    "The task is too long. Shorten the context and prepare the plan again. No call was placed.",
    "This task requires actions that are not available in this mode yet. No call was placed.",
    "Prepare and approve the plan again before calling."
  ],
  "de": [
    "Die Aufgabe ist zu umfangreich. Kürzen Sie den Kontext und erstellen Sie den Plan erneut. Es wurde kein Anruf gestartet.",
    "Diese Aufgabe erfordert Aktionen, die in diesem Modus noch nicht verfügbar sind. Es wurde kein Anruf gestartet.",
    "Erstellen und bestätigen Sie den Plan vor dem Anruf erneut."
  ],
  "fr": [
    "La tâche est trop longue. Réduisez le contexte et préparez à nouveau le plan. Aucun appel n’a été lancé.",
    "Cette tâche nécessite des actions qui ne sont pas encore disponibles dans ce mode. Aucun appel n’a été lancé.",
    "Préparez et confirmez à nouveau le plan avant d’appeler."
  ],
  "it": [
    "Il compito è troppo lungo. Riduci il contesto e prepara di nuovo il piano. Nessuna chiamata è stata avviata.",
    "Questo compito richiede azioni non ancora disponibili in questa modalità. Nessuna chiamata è stata avviata.",
    "Prepara e conferma di nuovo il piano prima di chiamare."
  ],
  "rm": [
    "L’incumbensa è memia lunga. Scurtanescha il context e prepara il plan danovamain. Nagina telefonada n’è vegnida iniziada.",
    "Questa incumbensa pretenda acziuns che n’èn anc betg disponiblas en quest modus. Nagina telefonada n’è vegnida iniziada.",
    "Prepara e conferma il plan danovamain avant da telefonar."
  ],
  "ru": [
    "Задание слишком объёмное. Сократите контекст и подготовьте план заново. Звонок не начат.",
    "Задание требует действий, которые пока недоступны в этом режиме. Звонок не начат.",
    "Подготовьте и подтвердите план заново перед звонком."
  ],
  "uk": [
    "Завдання надто об’ємне. Скоротіть контекст і підготуйте план знову. Дзвінок не розпочато.",
    "Завдання потребує дій, які поки недоступні в цьому режимі. Дзвінок не розпочато.",
    "Підготуйте та підтвердьте план знову перед дзвінком."
  ]
};

export function nativeLiveStartError(code: string, locale: UiLocale): string | null {
  if (code === "LIVE_NEW_CALL_REQUIRED") return {
    en: "Create a new call to keep this call’s previous recording and result.",
    de: "Erstellen Sie einen neuen Anruf, damit die bisherige Aufnahme und das Ergebnis erhalten bleiben.",
    fr: "Créez un nouvel appel pour conserver l’enregistrement et le résultat précédents.",
    it: "Crea una nuova chiamata per conservare la registrazione e il risultato precedenti.",
    rm: "Creescha ina nova telefonada per mantegnair la registraziun ed il resultat precedents.",
    ru: "Создайте новый звонок, чтобы сохранить предыдущую запись и результат этой карточки.",
    uk: "Створіть новий дзвінок, щоб зберегти попередній запис і результат цієї картки."
  }[locale];
  const index = ["LIVE_CONTEXT_TOO_LARGE", "LIVE_TASK_NOT_SUPPORTED", "LIVE_REAPPROVAL_REQUIRED"].indexOf(code);
  return index < 0 ? null : copy[locale][index]!;
}
