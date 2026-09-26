import type { AnsweringState, UiLocale } from "@callassist/contracts";

type Copy = {
  results: Record<"voicemail_detected" | "automated_answer" | "answer_unknown" | "fax_detected" | "answer_detection_failed", [string, string]>;
  checking: string; checkingHelp: string; consent: string; consentHelp: string;
  notRequested: string; policy: string; silent: string; neutral: string; uncertainty: string;
  approvedMessage: string; reviewAgain: string;
  message: Record<AnsweringState["message"], string>;
};
export const answeringMessages: Record<UiLocale, Copy> = {
  en: {
    approvedMessage: "Approved message text",
    reviewAgain: "The call policy changed. Review and approve the updated plan before calling.",
    results: {
      voicemail_detected: ["Voicemail detected", "The provider detected the end of a voicemail greeting. No conversation with a person was confirmed."],
      automated_answer: ["Automated answer detected", "An automated answer was detected. This does not establish that a voicemail inbox was reached."],
      answer_unknown: ["Answer could not be identified", "The call ended silently because the answering party could not be identified."],
      fax_detected: ["Fax detected", "The provider detected a fax. The call ended without speaking."],
      answer_detection_failed: ["Answer check failed", "The answering party could not be checked. The call was ended safely."]
    },
    checking: "Checking who answered", checkingHelp: "The phone connection is open. The assistant waits silently while the provider checks the answer.",
    consent: "Waiting for consent", consentHelp: "The provider classified the answer as human. The assistant asks for consent before starting the conversation.",
    notRequested: "Not requested", policy: "If voicemail answers", silent: "End without leaving a message.",
    neutral: "After a detected beep, attempt this exact neutral message once:",
    uncertainty: "Detection can be wrong. Playback completion does not confirm that voicemail saved the message or that anyone heard it.",
    message: { not_requested: "No message requested.", not_attempted: "Message not attempted: no confirmed beep.", issued: "Playing the neutral message.", playback_completed: "Message playback completed.", interrupted: "Message playback interrupted.", unknown: "Message playback completion could not be confirmed." }
  },
  de: {
    approvedMessage: "Genehmigter Nachrichtentext",
    reviewAgain: "Die Anrufregeln haben sich geändert. Prüfen und bestätigen Sie den aktualisierten Plan vor dem Anruf.",
    results: {
      voicemail_detected: ["Mailbox erkannt", "Der Anbieter hat das Ende einer Mailboxansage erkannt. Ein Gespräch mit einer Person ist nicht bestätigt."],
      automated_answer: ["Automatische Antwort erkannt", "Eine automatische Antwort wurde erkannt. Eine Mailbox ist damit nicht bestätigt."],
      answer_unknown: ["Antwort nicht zugeordnet", "Der Anruf wurde ohne Ansage beendet, weil nicht ermittelt werden konnte, wer geantwortet hat."],
      fax_detected: ["Fax erkannt", "Der Anbieter hat ein Fax erkannt. Der Anruf wurde ohne Ansage beendet."],
      answer_detection_failed: ["Antwortprüfung fehlgeschlagen", "Die Antwort konnte nicht geprüft werden. Der Anruf wurde sicher beendet."]
    },
    checking: "Antwort wird geprüft", checkingHelp: "Die Telefonverbindung steht. Der Assistent wartet still, während der Anbieter die Antwort prüft.",
    consent: "Einwilligung wird abgewartet", consentHelp: "Der Anbieter hat die Antwort als menschlich eingestuft. Der Assistent bittet vor dem Gespräch um Einwilligung.",
    notRequested: "Nicht angefragt", policy: "Wenn die Mailbox antwortet", silent: "Ohne Nachricht beenden.",
    neutral: "Nach erkanntem Signalton einmal diese genaue neutrale Nachricht versuchen:",
    uncertainty: "Die Erkennung kann falsch sein. Eine vollständige Wiedergabe bestätigt nicht, dass die Mailbox die Nachricht gespeichert oder jemand sie gehört hat.",
    message: { not_requested: "Keine Nachricht angefordert.", not_attempted: "Nachricht nicht versucht: kein bestätigter Signalton.", issued: "Neutrale Nachricht wird abgespielt.", playback_completed: "Wiedergabe der Nachricht abgeschlossen.", interrupted: "Wiedergabe unterbrochen.", unknown: "Vollständige Wiedergabe nicht bestätigt." }
  },
  fr: {
    approvedMessage: "Texte du message approuvé",
    reviewAgain: "Les règles d’appel ont changé. Vérifiez et approuvez le plan mis à jour avant d’appeler.",
    results: {
      voicemail_detected: ["Messagerie vocale détectée", "Le fournisseur a détecté la fin du message d’accueil. Aucune conversation avec une personne n’est confirmée."],
      automated_answer: ["Réponse automatique détectée", "Une réponse automatique a été détectée, sans confirmation d’une messagerie vocale."],
      answer_unknown: ["Réponse non identifiée", "L’appel s’est terminé sans annonce, car la réponse n’a pas pu être identifiée."],
      fax_detected: ["Fax détecté", "Le fournisseur a détecté un fax. L’appel s’est terminé sans annonce."],
      answer_detection_failed: ["Vérification de la réponse échouée", "La réponse n’a pas pu être vérifiée. L’appel a été terminé par précaution."]
    },
    checking: "Vérification de la réponse", checkingHelp: "La connexion est établie. L’assistant attend en silence pendant la vérification du fournisseur.",
    consent: "En attente du consentement", consentHelp: "Le fournisseur a classé la réponse comme humaine. L’assistant demande le consentement avant la conversation.",
    notRequested: "Non demandé", policy: "Si la messagerie répond", silent: "Terminer sans laisser de message.",
    neutral: "Après un bip détecté, tenter une seule fois ce message neutre exact :",
    uncertainty: "La détection peut se tromper. La fin de la lecture ne confirme ni l’enregistrement du message ni son écoute.",
    message: { not_requested: "Aucun message demandé.", not_attempted: "Message non tenté : aucun bip confirmé.", issued: "Lecture du message neutre.", playback_completed: "Lecture du message terminée.", interrupted: "Lecture du message interrompue.", unknown: "Fin de lecture du message non confirmée." }
  },
  it: {
    approvedMessage: "Testo del messaggio approvato",
    reviewAgain: "Le regole della chiamata sono cambiate. Verifica e approva il piano aggiornato prima di chiamare.",
    results: {
      voicemail_detected: ["Segreteria rilevata", "Il fornitore ha rilevato la fine del messaggio di benvenuto. Non è confermata una conversazione con una persona."],
      automated_answer: ["Risposta automatica rilevata", "È stata rilevata una risposta automatica, senza conferma di una segreteria."],
      answer_unknown: ["Risposta non identificata", "La chiamata è terminata in silenzio perché non è stato possibile identificare la risposta."],
      fax_detected: ["Fax rilevato", "Il fornitore ha rilevato un fax. La chiamata è terminata senza parlare."],
      answer_detection_failed: ["Verifica della risposta non riuscita", "Non è stato possibile verificare la risposta. La chiamata è stata terminata per sicurezza."]
    },
    checking: "Verifica della risposta", checkingHelp: "La connessione è stabilita. L’assistente attende in silenzio durante la verifica del fornitore.",
    consent: "In attesa del consenso", consentHelp: "Il fornitore ha classificato la risposta come umana. L’assistente chiede il consenso prima della conversazione.",
    notRequested: "Non richiesto", policy: "Se risponde la segreteria", silent: "Terminare senza lasciare un messaggio.",
    neutral: "Dopo un segnale acustico rilevato, tentare una sola volta questo esatto messaggio neutro:",
    uncertainty: "Il rilevamento può sbagliare. La riproduzione completa non conferma che il messaggio sia stato salvato o ascoltato.",
    message: { not_requested: "Nessun messaggio richiesto.", not_attempted: "Messaggio non tentato: nessun segnale confermato.", issued: "Riproduzione del messaggio neutro.", playback_completed: "Riproduzione del messaggio completata.", interrupted: "Riproduzione del messaggio interrotta.", unknown: "Fine della riproduzione non confermata." }
  },
  rm: {
    approvedMessage: "Text da la communicaziun approvà",
    reviewAgain: "Las reglas dal telefonat èn sa midadas. Controlla ed approvescha il plan actualisà avant da telefonar.",
    results: {
      voicemail_detected: ["Chascha vocala identifitgada", "Il purschider ha identifitgà la fin dal salid da la chascha vocala. In discurs cun ina persuna n’è betg confermà."],
      automated_answer: ["Resposta automatica identifitgada", "Ina resposta automatica è vegnida identifitgada. Ina chascha vocala n’è betg confermada."],
      answer_unknown: ["Resposta betg identifitgada", "Il telefonat è vegnì terminà senza discurrer, perquai che la resposta n’ha betg pudì vegnir identifitgada."],
      fax_detected: ["Fax identifitgà", "Il purschider ha identifitgà in fax. Il telefonat è vegnì terminà senza discurrer."],
      answer_detection_failed: ["Controlla da la resposta betg reussida", "La resposta n’ha betg pudì vegnir controllada. Il telefonat è vegnì terminà per segirezza."]
    },
    checking: "La resposta vegn controllada", checkingHelp: "La colliaziun è stabilida. L’assistent spetga en silenzi durant la controlla dal purschider.",
    consent: "Spetgar il consentiment", consentHelp: "Il purschider ha classifitgà la resposta sco umana. L’assistent dumonda il consentiment avant il discurs.",
    notRequested: "Betg dumandà", policy: "Sche la chascha vocala respunda", silent: "Terminar senza laschar ina communicaziun.",
    neutral: "Suenter in signal sonor identifitgà, empruvar ina suletta giada questa communicaziun neutrala exacta:",
    uncertainty: "L’identificaziun po sbagliar. La reproducziun cumpletta na conferma betg che la communicaziun saja memorisada u tadlada.",
    message: { not_requested: "Nagina communicaziun dumandada.", not_attempted: "Communicaziun betg empruvada: nagin signal confermà.", issued: "La communicaziun neutrala vegn reproducida.", playback_completed: "Reproducziun da la communicaziun terminada.", interrupted: "Reproducziun interrutta.", unknown: "Fin da la reproducziun betg confermada." }
  },
  ru: {
    approvedMessage: "Утверждённый текст сообщения",
    reviewAgain: "Правила звонка изменились. Проверьте и подтвердите обновлённый план перед звонком.",
    results: {
      voicemail_detected: ["Сработал автоответчик", "Провайдер определил конец приветствия автоответчика. Разговор с человеком не подтверждён."],
      automated_answer: ["Обнаружен автоматический ответ", "Обнаружен автоматический ответ. Это ещё не подтверждает подключение к голосовой почте."],
      answer_unknown: ["Не удалось определить, кто ответил", "Звонок завершён без речи: не удалось определить, кто ответил."],
      fax_detected: ["Обнаружен факс", "Провайдер обнаружил факс. Звонок завершён без речи."],
      answer_detection_failed: ["Ошибка проверки ответа", "Не удалось проверить, кто ответил. Звонок безопасно завершён."]
    },
    checking: "Проверяем, кто ответил", checkingHelp: "Телефонное соединение установлено. Ассистент молчит, пока провайдер проверяет ответ.",
    consent: "Ожидаем согласия", consentHelp: "Провайдер определил ответ как человеческий. Перед разговором ассистент запрашивает согласие.",
    notRequested: "Не запрашивалось", policy: "Если ответит автоответчик", silent: "Завершить без сообщения.",
    neutral: "После обнаруженного сигнала один раз попытаться прочитать этот нейтральный текст без изменений:",
    uncertainty: "Определение может быть ошибочным. Завершение воспроизведения не подтверждает, что голосовая почта сохранила сообщение или кто-то его услышал.",
    message: { not_requested: "Сообщение не запрошено.", not_attempted: "Сообщение не зачитывалось: сигнал не подтверждён.", issued: "Зачитывается нейтральное сообщение.", playback_completed: "Воспроизведение сообщения завершено.", interrupted: "Воспроизведение сообщения прервано.", unknown: "Завершение воспроизведения сообщения не подтверждено." }
  },
  uk: {
    approvedMessage: "Затверджений текст повідомлення",
    reviewAgain: "Правила дзвінка змінилися. Перевірте та підтвердьте оновлений план перед дзвінком.",
    results: {
      voicemail_detected: ["Спрацював автовідповідач", "Провайдер визначив кінець привітання автовідповідача. Розмову з людиною не підтверджено."],
      automated_answer: ["Виявлено автоматичну відповідь", "Виявлено автоматичну відповідь. Це ще не підтверджує з’єднання з голосовою поштою."],
      answer_unknown: ["Не вдалося визначити, хто відповів", "Дзвінок завершено без мовлення: не вдалося визначити, хто відповів."],
      fax_detected: ["Виявлено факс", "Провайдер виявив факс. Дзвінок завершено без мовлення."],
      answer_detection_failed: ["Помилка перевірки відповіді", "Не вдалося перевірити, хто відповів. Дзвінок безпечно завершено."]
    },
    checking: "Перевіряємо, хто відповів", checkingHelp: "Телефонне з’єднання встановлено. Асистент мовчить, поки провайдер перевіряє відповідь.",
    consent: "Очікуємо згоди", consentHelp: "Провайдер визначив відповідь як людську. Перед розмовою асистент запитує згоду.",
    notRequested: "Не запитувалася", policy: "Якщо відповість автовідповідач", silent: "Завершити без повідомлення.",
    neutral: "Після виявленого сигналу один раз спробувати прочитати цей нейтральний текст без змін:",
    uncertainty: "Визначення може бути помилковим. Завершення відтворення не підтверджує, що голосова пошта зберегла повідомлення або хтось його почув.",
    message: { not_requested: "Повідомлення не запитано.", not_attempted: "Повідомлення не зачитувалося: сигнал не підтверджено.", issued: "Зачитується нейтральне повідомлення.", playback_completed: "Відтворення повідомлення завершено.", interrupted: "Відтворення повідомлення перервано.", unknown: "Завершення відтворення повідомлення не підтверджено." }
  }
};
