import { formatLocale, type BetaCreditPolicy, type UiLocale } from "@callassist/contracts";

type Copy = { credits: string; period: Record<BetaCreditPolicy["period"], string>; noCarry: string; full: string; open: string;
  places: { one: string; few?: string; many?: string; other: string }; loading: string; persistent: string; available: string;
  reserved: string; used: string; resets: string; expires: string; pending: string; limited: string };
export const betaCreditMessages: Record<UiLocale, Copy> = {
  en: { credits: "Beta call credits", period: { lifetime: "once", day: "per day", week: "per week", month: "per month" }, noCarry: "Unused periodic credits do not carry over.", full: "Open beta registration is full. You can still use an invitation.", open: "Beta registration is open.", places: { one: "{n} beta place remaining", other: "{n} beta places remaining" }, loading: "Checking beta availability…", persistent: "Permanent credits", available: "Current allowance available", reserved: "Reserved", used: "Used", resets: "Next renewal (UTC)", expires: "Period ends (UTC)", pending: "Next credit policy", limited: "Beta access is limited" },
  de: { credits: "Beta-Anrufguthaben", period: { lifetime: "einmalig", day: "pro Tag", week: "pro Woche", month: "pro Monat" }, noCarry: "Ungenutztes periodisches Guthaben wird nicht übertragen.", full: "Die offene Beta-Registrierung ist voll. Sie können weiterhin eine Einladung nutzen.", open: "Die Beta-Registrierung ist offen.", places: { one: "Noch {n} Beta-Platz verfügbar", other: "Noch {n} Beta-Plätze verfügbar" }, loading: "Beta-Verfügbarkeit wird geprüft…", persistent: "Unbefristetes Guthaben", available: "Aktuell verfügbares Kontingent", reserved: "Reserviert", used: "Verbraucht", resets: "Nächste Erneuerung (UTC)", expires: "Periodenende (UTC)", pending: "Nächste Guthabenregel", limited: "Der Beta-Zugang ist begrenzt" },
  fr: { credits: "Crédits d’appel bêta", period: { lifetime: "une fois", day: "par jour", week: "par semaine", month: "par mois" }, noCarry: "Les crédits périodiques inutilisés ne sont pas reportés.", full: "Les inscriptions libres à la bêta sont complètes. Une invitation reste utilisable.", open: "Les inscriptions à la bêta sont ouvertes.", places: { one: "{n} place bêta restante", other: "{n} places bêta restantes" }, loading: "Vérification des places bêta…", persistent: "Crédits permanents", available: "Quota actuellement disponible", reserved: "Réservés", used: "Utilisés", resets: "Prochain renouvellement (UTC)", expires: "Fin de période (UTC)", pending: "Prochaine règle de crédits", limited: "L’accès à la bêta est limité" },
  it: { credits: "Crediti chiamata beta", period: { lifetime: "una volta", day: "al giorno", week: "alla settimana", month: "al mese" }, noCarry: "I crediti periodici non utilizzati non si accumulano.", full: "Le iscrizioni libere alla beta sono complete. Puoi ancora usare un invito.", open: "Le iscrizioni alla beta sono aperte.", places: { one: "{n} posto beta disponibile", other: "{n} posti beta disponibili" }, loading: "Verifica della disponibilità beta…", persistent: "Crediti permanenti", available: "Quota attualmente disponibile", reserved: "Riservati", used: "Utilizzati", resets: "Prossimo rinnovo (UTC)", expires: "Fine periodo (UTC)", pending: "Prossima regola dei crediti", limited: "L’accesso alla beta è limitato" },
  rm: { credits: "Credits da telefonat beta", period: { lifetime: "ina giada", day: "per di", week: "per emna", month: "per mais" }, noCarry: "Credits periodics betg duvrads na vegnan betg transferids.", full: "La registraziun libra per la beta è plaina. Ti pos anc duvrar in invit.", open: "La registraziun per la beta è averta.", places: { one: "Anc {n} plazza beta libra", other: "Anc {n} plazzas beta libras" }, loading: "Controlla da las plazzas beta…", persistent: "Credits permanents", available: "Quota actualmain disponibla", reserved: "Reservads", used: "Duvrads", resets: "Proxima renovaziun (UTC)", expires: "Fin da la perioda (UTC)", pending: "Proxima regla da credits", limited: "L’access a la beta è limità" },
  ru: { credits: "Кредиты на звонки в бете", period: { lifetime: "однократно", day: "в день", week: "в неделю", month: "в месяц" }, noCarry: "Неиспользованные периодические кредиты не накапливаются.", full: "Свободных мест в бете нет. Вы по-прежнему можете воспользоваться приглашением.", open: "Регистрация в бете открыта.", places: { one: "Осталось {n} место в бете", few: "Осталось {n} места в бете", many: "Осталось {n} мест в бете", other: "Осталось {n} места в бете" }, loading: "Проверяем доступность беты…", persistent: "Постоянные кредиты", available: "Доступно в текущем периоде", reserved: "Зарезервировано", used: "Использовано", resets: "Следующее обновление (UTC)", expires: "Конец периода (UTC)", pending: "Следующее правило кредитов", limited: "Доступ к бете ограничен" },
  uk: { credits: "Кредити на дзвінки в бета-тесті", period: { lifetime: "одноразово", day: "на день", week: "на тиждень", month: "на місяць" }, noCarry: "Невикористані періодичні кредити не накопичуються.", full: "Вільних місць у бета-тесті немає. Ви все ще можете скористатися запрошенням.", open: "Реєстрацію в бета-тесті відкрито.", places: { one: "Залишилося {n} місце в бета-тесті", few: "Залишилося {n} місця в бета-тесті", many: "Залишилося {n} місць у бета-тесті", other: "Залишилося {n} місця в бета-тесті" }, loading: "Перевіряємо доступність бета-тесту…", persistent: "Постійні кредити", available: "Доступно в поточному періоді", reserved: "Зарезервовано", used: "Використано", resets: "Наступне оновлення (UTC)", expires: "Кінець періоду (UTC)", pending: "Наступне правило кредитів", limited: "Доступ до бета-тесту обмежений" }
};
export function betaAllowanceText(policy: BetaCreditPolicy, locale: UiLocale) {
  const copy = betaCreditMessages[locale];
  return `${copy.credits}: ${new Intl.NumberFormat(formatLocale(locale)).format(policy.amount)} ${copy.period[policy.period]}`;
}
export function betaPlacesText(count: number, locale: UiLocale) {
  const forms = betaCreditMessages[locale].places;
  const category = new Intl.PluralRules(formatLocale(locale)).select(count) as keyof typeof forms;
  return (forms[category] ?? forms.other).replace("{n}", new Intl.NumberFormat(formatLocale(locale)).format(count));
}
export const betaExpiredLabel: Record<UiLocale, string> = {
  en: "Expired period", de: "Abgelaufene Periode", fr: "Période expirée", it: "Periodo scaduto", rm: "Perioda scadida", ru: "Истёкший период", uk: "Період завершено"
};
export const betaLifetimeTransitionMessage: Record<UiLocale, string> = {
  en: "This policy change adds no new one-time credit grant.",
  de: "Diese Regeländerung gewährt kein neues einmaliges Guthaben.",
  fr: "Ce changement de règle n’ajoute aucun nouveau crédit unique.",
  it: "Questa modifica della regola non assegna nuovi crediti una tantum.",
  rm: "Questa midada da regla na conceda nagins novs credits unics.",
  ru: "Это изменение правила не начисляет новые однократные кредиты.",
  uk: "Ця зміна правила не нараховує нові одноразові кредити."
};
export const betaInsufficientCreditMessages: Record<UiLocale, string> = {
  en: "No call credits are available. Check your account for the next allowance renewal or redeem a promo code.",
  de: "Kein Anrufguthaben verfügbar. Prüfen Sie im Konto die nächste Erneuerung oder lösen Sie einen Aktionscode ein.",
  fr: "Aucun crédit d’appel disponible. Consultez le prochain renouvellement dans votre compte ou utilisez un code promotionnel.",
  it: "Nessun credito chiamata disponibile. Controlla il prossimo rinnovo nel tuo account o usa un codice promozionale.",
  rm: "Nagins credits da telefonat disponibels. Guarda la proxima renovaziun en tes conto u dovra in code da promoziun.",
  ru: "Нет доступных кредитов на звонки. Проверьте в аккаунте дату следующего обновления квоты или используйте промокод.",
  uk: "Немає доступних кредитів на дзвінки. Перевірте в акаунті дату наступного оновлення квоти або використайте промокод."
};
