import type { UiLocale } from "@callassist/contracts";
type Copy = {
  registration: string; call: string; name: string; email: string; verified: string; phone: string;
  language: string; created: string; phoneVerified: string; userId: string; openUsers: string;
  user: string; recipient: string; task: string; status: string; failure: string; started: string; ended: string;
  connected: string; elapsed: string; assessment: string; conversation: string; goal: string; criterion: string;
  summary: string; next: string; unavailable: string; coverage: string; partial: string; available: string;
  shared: string; preliminary: string; prepared: string; callId: string; attemptId: string; openCall: string;
  settings: string; yes: string; no: string; goals: Record<string, string>;
};
export const notificationMessages: Record<UiLocale, Copy> = {
  en: {
    registration: "New registration confirmed", call: "Call finished", name: "Name", email: "Email", verified: "Email verified", phone: "Phone",
    language: "Language", created: "Account created", phoneVerified: "Phone verified", userId: "User ID", openUsers: "Open users",
    user: "User", recipient: "Recipient", task: "Task", status: "Status", failure: "Failure reason", started: "Started", ended: "Ended",
    connected: "Connected duration", elapsed: "Total attempt duration (including dialing)", assessment: "AI assessment", conversation: "Conversation", goal: "Goal", criterion: "Criterion {number}",
    summary: "Summary (original language)", next: "Next steps (original language)", unavailable: "Unavailable", coverage: "Cost coverage", partial: "Partial — some usage or provider prices are unavailable", available: "Available at report time",
    shared: "Shared preparation costs are listed separately and are not charged again for each attempt.", preliminary: "Costs are preliminary. Later usage and provider prices appear in the call inspector.", prepared: "Report prepared", callId: "Call ID", attemptId: "Attempt ID", openCall: "Open call inspector",
    settings: "Notification settings", yes: "Yes", no: "No", goals: { achieved: "Achieved", partial: "Partially achieved", not_achieved: "Not achieved", uncertain: "Uncertain" }
  },
  de: {
    registration: "Neue Registrierung bestätigt", call: "Anruf beendet", name: "Name", email: "E-Mail", verified: "E-Mail bestätigt", phone: "Telefon",
    language: "Sprache", created: "Konto erstellt", phoneVerified: "Telefon bestätigt", userId: "Nutzer-ID", openUsers: "Nutzer öffnen",
    user: "Nutzer", recipient: "Angerufene Person", task: "Aufgabe", status: "Status", failure: "Fehlergrund", started: "Beginn", ended: "Ende",
    connected: "Verbindungsdauer", elapsed: "Gesamtdauer des Versuchs einschliesslich Wählen", assessment: "KI-Bewertung", conversation: "Gespräch", goal: "Ziel", criterion: "Kriterium {number}",
    summary: "Zusammenfassung (Originalsprache)", next: "Nächste Schritte (Originalsprache)", unavailable: "Nicht verfügbar", coverage: "Kostenabdeckung", partial: "Teilweise — einige Nutzungsdaten oder Anbieterpreise fehlen", available: "Zum Berichtszeitpunkt verfügbar",
    shared: "Gemeinsame Vorbereitungskosten werden separat aufgeführt und nicht bei jedem Versuch erneut berechnet.", preliminary: "Die Kosten sind vorläufig. Spätere Nutzungsdaten und Anbieterpreise erscheinen in den Anrufdetails.", prepared: "Bericht erstellt", callId: "Anruf-ID", attemptId: "Versuchs-ID", openCall: "Anrufdetails öffnen",
    settings: "Benachrichtigungseinstellungen", yes: "Ja", no: "Nein", goals: { achieved: "Erreicht", partial: "Teilweise erreicht", not_achieved: "Nicht erreicht", uncertain: "Unklar" }
  },
  fr: {
    registration: "Nouvelle inscription confirmée", call: "Appel terminé", name: "Nom", email: "E-mail", verified: "E-mail vérifié", phone: "Téléphone",
    language: "Langue", created: "Compte créé", phoneVerified: "Téléphone vérifié", userId: "ID utilisateur", openUsers: "Voir les utilisateurs",
    user: "Utilisateur", recipient: "Destinataire", task: "Demande", status: "Statut", failure: "Motif de l’échec", started: "Début", ended: "Fin",
    connected: "Durée de connexion", elapsed: "Durée totale, connexion comprise", assessment: "Évaluation IA", conversation: "Conversation", goal: "Objectif", criterion: "Critère {number}",
    summary: "Résumé (langue originale)", next: "Prochaines étapes (langue originale)", unavailable: "Indisponible", coverage: "Couverture des coûts", partial: "Partielle — certaines données d’utilisation ou certains tarifs manquent", available: "Disponible lors du rapport",
    shared: "Les frais de préparation communs sont indiqués séparément et ne sont pas recomptés à chaque tentative.", preliminary: "Les coûts sont provisoires. Les données et tarifs reçus plus tard apparaîtront dans les détails de l’appel.", prepared: "Rapport préparé", callId: "ID de l’appel", attemptId: "ID de la tentative", openCall: "Voir les détails de l’appel",
    settings: "Paramètres de notification", yes: "Oui", no: "Non", goals: { achieved: "Atteint", partial: "Partiellement atteint", not_achieved: "Non atteint", uncertain: "Incertain" }
  },
  it: {
    registration: "Nuova registrazione confermata", call: "Chiamata terminata", name: "Nome", email: "E-mail", verified: "E-mail verificata", phone: "Telefono",
    language: "Lingua", created: "Account creato", phoneVerified: "Telefono verificato", userId: "ID utente", openUsers: "Apri utenti",
    user: "Utente", recipient: "Destinatario", task: "Richiesta", status: "Stato", failure: "Motivo dell’errore", started: "Inizio", ended: "Fine",
    connected: "Durata della connessione", elapsed: "Durata totale, composizione inclusa", assessment: "Valutazione IA", conversation: "Conversazione", goal: "Obiettivo", criterion: "Criterio {number}",
    summary: "Riepilogo (lingua originale)", next: "Prossimi passi (lingua originale)", unavailable: "Non disponibile", coverage: "Completezza dei costi", partial: "Parziale — mancano alcuni dati di utilizzo o prezzi", available: "Disponibile al momento del rapporto",
    shared: "I costi comuni di preparazione sono elencati separatamente e non vengono conteggiati di nuovo per ogni tentativo.", preliminary: "I costi sono provvisori. Dati e prezzi ricevuti in seguito appariranno nei dettagli della chiamata.", prepared: "Rapporto preparato", callId: "ID chiamata", attemptId: "ID tentativo", openCall: "Apri i dettagli della chiamata",
    settings: "Impostazioni delle notifiche", yes: "Sì", no: "No", goals: { achieved: "Raggiunto", partial: "Raggiunto in parte", not_achieved: "Non raggiunto", uncertain: "Incerto" }
  },
  rm: {
    registration: "Nova registraziun confermada", call: "Telefonat terminà", name: "Num", email: "E-mail", verified: "E-mail confermà", phone: "Telefon",
    language: "Lingua", created: "Conto creà", phoneVerified: "Telefon confermà", userId: "ID da l’utilisader", openUsers: "Avrir ils utilisaders",
    user: "Utilisader", recipient: "Destinatari", task: "Dumonda", status: "Status", failure: "Motiv dal sbagl", started: "Cumenzament", ended: "Fin",
    connected: "Durada da la colliaziun", elapsed: "Durada totala inclus il tscherner", assessment: "Valitaziun da l’IA", conversation: "Discurs", goal: "Finamira", criterion: "Criteri {number}",
    summary: "Resumaziun (lingua originala)", next: "Proxims pass (lingua originala)", unavailable: "Betg disponibel", coverage: "Cumplettadad dals custs", partial: "Parziala — tschertas datas d’utilisaziun u pretschs mancan", available: "Disponibel al mument dal rapport",
    shared: "Custs communabels da preparaziun vegnan inditgads separadamain e na vegnan betg quintads danovamain per mintga emprova.", preliminary: "Ils custs èn provisorics. Datas e pretschs retschavids pli tard cumparan en ils detagls dal telefonat.", prepared: "Rapport preparà", callId: "ID dal telefonat", attemptId: "ID da l’emprova", openCall: "Avrir ils detagls dal telefonat",
    settings: "Parameters da communicaziuns", yes: "Gea", no: "Na", goals: { achieved: "Cuntanschì", partial: "Cuntanschì per part", not_achieved: "Betg cuntanschì", uncertain: "Malsegir" }
  },
  ru: {
    registration: "Подтверждена новая регистрация", call: "Звонок завершён", name: "Имя", email: "Почта", verified: "Почта подтверждена", phone: "Телефон",
    language: "Язык", created: "Аккаунт создан", phoneVerified: "Телефон подтверждён", userId: "ID пользователя", openUsers: "Открыть пользователей",
    user: "Пользователь", recipient: "Получатель", task: "Задача", status: "Статус", failure: "Причина ошибки", started: "Начало", ended: "Завершение",
    connected: "Длительность соединения", elapsed: "Общая длительность, включая набор номера", assessment: "Оценка ИИ", conversation: "Разговор", goal: "Цель", criterion: "Критерий {number}",
    summary: "Сводка (на исходном языке)", next: "Следующие шаги (на исходном языке)", unavailable: "Недоступно", coverage: "Полнота расходов", partial: "Частичная — часть данных об использовании или ценах отсутствует", available: "Доступны на момент отчёта",
    shared: "Общие расходы на подготовку указаны отдельно и не учитываются повторно для каждой попытки.", preliminary: "Расходы предварительные. Позднейшие данные и цены появятся в подробностях звонка.", prepared: "Отчёт подготовлен", callId: "ID звонка", attemptId: "ID попытки", openCall: "Открыть подробности звонка",
    settings: "Настройки уведомлений", yes: "Да", no: "Нет", goals: { achieved: "Достигнута", partial: "Частично достигнута", not_achieved: "Не достигнута", uncertain: "Неясно" }
  },
  uk: {
    registration: "Підтверджено нову реєстрацію", call: "Дзвінок завершено", name: "Ім’я", email: "Пошта", verified: "Пошту підтверджено", phone: "Телефон",
    language: "Мова", created: "Обліковий запис створено", phoneVerified: "Телефон підтверджено", userId: "ID користувача", openUsers: "Відкрити користувачів",
    user: "Користувач", recipient: "Отримувач", task: "Завдання", status: "Стан", failure: "Причина помилки", started: "Початок", ended: "Завершення",
    connected: "Тривалість з’єднання", elapsed: "Загальна тривалість, зокрема набір номера", assessment: "Оцінка ШІ", conversation: "Розмова", goal: "Мета", criterion: "Критерій {number}",
    summary: "Підсумок (початковою мовою)", next: "Наступні кроки (початковою мовою)", unavailable: "Недоступно", coverage: "Повнота витрат", partial: "Часткова — частина даних про використання чи ціни відсутня", available: "Доступні на час звіту",
    shared: "Спільні витрати на підготовку вказано окремо, вони не враховуються повторно для кожної спроби.", preliminary: "Витрати попередні. Пізніші дані й ціни з’являться в подробицях дзвінка.", prepared: "Звіт підготовлено", callId: "ID дзвінка", attemptId: "ID спроби", openCall: "Відкрити подробиці дзвінка",
    settings: "Налаштування сповіщень", yes: "Так", no: "Ні", goals: { achieved: "Досягнуто", partial: "Частково досягнуто", not_achieved: "Не досягнуто", uncertain: "Невідомо" }
  }
};
