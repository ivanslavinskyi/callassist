import type { UiLocale } from "@callassist/contracts";

const en = {
  title: "Spoken consent recognition", mode: "Recognition mode", native: "Current semantic recognition", hybrid: "Hybrid: local recognition, semantic fallback",
  scope: "Changes apply to new call attempts. Calls already started keep their selected mode.",
  hybridHelp: "Hybrid recognizes short, clear answers after a brief pause. A delayed qualification can arrive after a decision; unclear answers still use semantic recognition.",
  reason: "Reason for this change", revision: "Revision", updated: "Last changed", save: "Save consent settings", saving: "Saving…",
  refresh: "Refresh settings", loading: "Loading consent settings…", saved: "Consent settings saved for new call attempts.",
  error: "The settings could not be confirmed. Refresh before trying again.", stale: "Another administrator changed these settings. Refresh and review the current mode.",
  restricted: "Only a superadmin can change consent recognition.", initial: "Initial default", invalid: "Select a mode and enter a reason of at least 3 characters."
};
export type VoiceConsentCopy = typeof en;
export const voiceConsentMessages: Record<UiLocale, VoiceConsentCopy> = {
  en,
  de: {
    title: "Erkennung der gesprochenen Zustimmung", mode: "Erkennungsmodus", native: "Bisherige semantische Erkennung", hybrid: "Hybrid: lokale Erkennung mit semantischem Rückfall",
    scope: "Änderungen gelten für neue Anrufversuche. Bereits gestartete Anrufe behalten ihren gewählten Modus.",
    hybridHelp: "Hybrid erkennt kurze, eindeutige Antworten nach einer kurzen Pause. Eine verspätete Einschränkung kann nach der Entscheidung eintreffen; unklare Antworten werden weiterhin semantisch erkannt.",
    reason: "Grund für diese Änderung", revision: "Revision", updated: "Zuletzt geändert", save: "Zustimmungseinstellungen speichern", saving: "Wird gespeichert…",
    refresh: "Einstellungen aktualisieren", loading: "Zustimmungseinstellungen werden geladen…", saved: "Zustimmungseinstellungen für neue Anrufversuche gespeichert.",
    error: "Die Einstellungen konnten nicht bestätigt werden. Vor einem neuen Versuch aktualisieren.", stale: "Eine andere Administration hat diese Einstellungen geändert. Aktualisieren und den aktuellen Modus prüfen.",
    restricted: "Nur Superadmins können die Zustimmungserkennung ändern.", initial: "Anfänglicher Standard", invalid: "Einen Modus wählen und einen Grund mit mindestens 3 Zeichen eingeben."
  },
  fr: {
    title: "Reconnaissance du consentement oral", mode: "Mode de reconnaissance", native: "Reconnaissance sémantique actuelle", hybrid: "Hybride : reconnaissance locale, puis sémantique si nécessaire",
    scope: "Les modifications s’appliquent aux nouvelles tentatives d’appel. Les appels déjà commencés conservent leur mode.",
    hybridHelp: "Le mode hybride reconnaît les réponses brèves et claires après une courte pause. Une réserve tardive peut arriver après la décision ; les réponses ambiguës restent traitées par reconnaissance sémantique.",
    reason: "Motif de la modification", revision: "Révision", updated: "Dernière modification", save: "Enregistrer les réglages de consentement", saving: "Enregistrement…",
    refresh: "Actualiser les réglages", loading: "Chargement des réglages de consentement…", saved: "Réglages de consentement enregistrés pour les nouvelles tentatives d’appel.",
    error: "Les réglages n’ont pas pu être confirmés. Actualisez avant de réessayer.", stale: "Un autre administrateur a modifié ces réglages. Actualisez et vérifiez le mode actuel.",
    restricted: "Seul un superadmin peut modifier la reconnaissance du consentement.", initial: "Valeur initiale", invalid: "Choisissez un mode et indiquez un motif d’au moins 3 caractères."
  },
  it: {
    title: "Riconoscimento del consenso vocale", mode: "Modalità di riconoscimento", native: "Riconoscimento semantico attuale", hybrid: "Ibrida: riconoscimento locale, con supporto semantico",
    scope: "Le modifiche si applicano ai nuovi tentativi di chiamata. Le chiamate già iniziate mantengono la modalità scelta.",
    hybridHelp: "La modalità ibrida riconosce risposte brevi e chiare dopo una breve pausa. Una precisazione tardiva può arrivare dopo la decisione; le risposte ambigue continuano a usare il riconoscimento semantico.",
    reason: "Motivo della modifica", revision: "Revisione", updated: "Ultima modifica", save: "Salva le impostazioni del consenso", saving: "Salvataggio…",
    refresh: "Aggiorna le impostazioni", loading: "Caricamento delle impostazioni del consenso…", saved: "Impostazioni del consenso salvate per i nuovi tentativi di chiamata.",
    error: "Impossibile confermare le impostazioni. Aggiorna prima di riprovare.", stale: "Un altro amministratore ha modificato le impostazioni. Aggiorna e verifica la modalità attuale.",
    restricted: "Solo un superadmin può modificare il riconoscimento del consenso.", initial: "Valore iniziale", invalid: "Scegli una modalità e inserisci un motivo di almeno 3 caratteri."
  },
  rm: {
    title: "Identificaziun dal consentiment oral", mode: "Modus d’identificaziun", native: "Identificaziun semantica actuala", hybrid: "Ibrid: identificaziun locala cun sustegn semantic",
    scope: "Las midadas valan per novas emprovas da telefonar. Cloms gia cumenzads mantegnan lur modus tschernì.",
    hybridHelp: "Il modus ibrid identifitgescha respostas curtas e cleras suenter ina curta pausa. Ina restricziun tardiva po arrivar suenter la decisiun; respostas nuncleras vegnan vinavant identifitgadas semanticamain.",
    reason: "Motiv da questa midada", revision: "Revisiun", updated: "Ultima midada", save: "Memorisar ils parameters dal consentiment", saving: "Memorisaziun…",
    refresh: "Actualisar ils parameters", loading: "Chargiar ils parameters dal consentiment…", saved: "Parameters dal consentiment memorisads per novas emprovas da telefonar.",
    error: "Ils parameters n’han betg pudì vegnir confermads. Actualisai avant da reempruvar.", stale: "In auter administratur ha midà quests parameters. Actualisai e controllai il modus actual.",
    restricted: "Mo in superadmin po midar l’identificaziun dal consentiment.", initial: "Valur iniziala", invalid: "Tscherni in modus ed inditgai in motiv cun almain 3 segns."
  },
  ru: {
    title: "Распознавание устного согласия", mode: "Режим распознавания", native: "Текущее семантическое распознавание", hybrid: "Гибридное: локально, при неясности — семантически",
    scope: "Изменения действуют для новых попыток звонка. Уже начатые звонки сохраняют выбранный режим.",
    hybridHelp: "Гибридный режим распознаёт краткие однозначные ответы после короткой паузы. Позднее уточнение может поступить после решения; неясные ответы по-прежнему обрабатываются семантически.",
    reason: "Причина изменения", revision: "Ревизия", updated: "Последнее изменение", save: "Сохранить настройки согласия", saving: "Сохранение…",
    refresh: "Обновить настройки", loading: "Загрузка настроек согласия…", saved: "Настройки согласия сохранены для новых попыток звонка.",
    error: "Не удалось подтвердить настройки. Обновите их перед повторной попыткой.", stale: "Другой администратор изменил настройки. Обновите и проверьте текущий режим.",
    restricted: "Изменить распознавание согласия может только суперадминистратор.", initial: "Исходное значение", invalid: "Выберите режим и укажите причину длиной не менее 3 символов."
  },
  uk: {
    title: "Розпізнавання усної згоди", mode: "Режим розпізнавання", native: "Поточне семантичне розпізнавання", hybrid: "Гібридне: локально, за неясності — семантично",
    scope: "Зміни діють для нових спроб дзвінка. Уже розпочаті дзвінки зберігають обраний режим.",
    hybridHelp: "Гібридний режим розпізнає короткі однозначні відповіді після короткої паузи. Пізнє уточнення може надійти після рішення; неясні відповіді й далі обробляються семантично.",
    reason: "Причина зміни", revision: "Ревізія", updated: "Остання зміна", save: "Зберегти налаштування згоди", saving: "Збереження…",
    refresh: "Оновити налаштування", loading: "Завантаження налаштувань згоди…", saved: "Налаштування згоди збережено для нових спроб дзвінка.",
    error: "Не вдалося підтвердити налаштування. Оновіть їх перед повторною спробою.", stale: "Інший адміністратор змінив налаштування. Оновіть і перевірте поточний режим.",
    restricted: "Змінити розпізнавання згоди може лише суперадміністратор.", initial: "Початкове значення", invalid: "Оберіть режим і вкажіть причину завдовжки щонайменше 3 символи."
  }
};
