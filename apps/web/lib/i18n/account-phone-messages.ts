import type { UiLocale } from "@callassist/contracts";

const en = {
  swissPhonesOnly: "Only Swiss numbers for registration and phone changes",
  swissPhonesOnlyHelp: "Require a Swiss (+41) number for registration and phone changes. Existing verified accounts keep access.",
  swissPhoneHelp: "Use a Swiss phone number (+41). We will send an SMS verification code. Spaces and the national format are accepted.",
  swissPhoneRequired: "A valid Swiss phone number (+41) is required. Numbers from other countries are not accepted.",
  accountPhoneHelp: "Choose the country of your number. We will send an SMS verification code. Spaces are accepted.",
  phoneCorrectionHelp: "Use the email and password you registered with. Enter a new phone number and verify it by SMS.",
  phonePolicyLoading: "Loading phone requirements…"
};
type Copy = typeof en;
export const accountPhoneMessages: Record<UiLocale, Copy> = {
  en,
  de: {
    swissPhonesOnly: "Nur Schweizer Nummern für Registrierung und Nummernwechsel",
    swissPhonesOnlyHelp: "Für Registrierung und Nummernwechsel ist eine Schweizer Nummer (+41) erforderlich. Bestehende bestätigte Konten behalten ihren Zugang.",
    swissPhoneHelp: "Verwenden Sie eine Schweizer Telefonnummer (+41). Wir senden einen SMS-Bestätigungscode. Leerzeichen und das nationale Format sind erlaubt.",
    swissPhoneRequired: "Eine gültige Schweizer Telefonnummer (+41) ist erforderlich. Nummern aus anderen Ländern werden nicht akzeptiert.",
    accountPhoneHelp: "Wählen Sie das Land Ihrer Nummer. Wir senden einen SMS-Bestätigungscode. Leerzeichen sind erlaubt.",
    phoneCorrectionHelp: "Verwenden Sie E-Mail und Passwort Ihrer Registrierung. Geben Sie eine neue Telefonnummer ein und bestätigen Sie sie per SMS.",
    phonePolicyLoading: "Anforderungen an die Telefonnummer werden geladen…"
  },
  ru: {
    swissPhonesOnly: "Только швейцарские номера при регистрации и смене номера",
    swissPhonesOnlyHelp: "Для регистрации и смены номера требуется швейцарский номер (+41). Подтверждённые аккаунты сохраняют доступ.",
    swissPhoneHelp: "Укажите швейцарский номер (+41). На него мы отправим SMS с кодом подтверждения. Можно вводить пробелы и номер в национальном формате.",
    swissPhoneRequired: "Нужен корректный швейцарский номер (+41). Номера других стран не принимаются.",
    accountPhoneHelp: "Выберите страну номера. На него мы отправим SMS с кодом подтверждения. Пробелы допустимы.",
    phoneCorrectionHelp: "Используйте email и пароль, указанные при регистрации. Введите новый номер и подтвердите его по SMS.",
    phonePolicyLoading: "Загружаем требования к номеру…"
  },
  uk: {
    swissPhonesOnly: "Лише швейцарські номери для реєстрації та зміни номера",
    swissPhonesOnlyHelp: "Для реєстрації та зміни номера потрібен швейцарський номер (+41). Підтверджені облікові записи зберігають доступ.",
    swissPhoneHelp: "Вкажіть швейцарський номер (+41). На нього ми надішлемо SMS із кодом підтвердження. Дозволені пробіли та національний формат.",
    swissPhoneRequired: "Потрібен коректний швейцарський номер (+41). Номери інших країн не приймаються.",
    accountPhoneHelp: "Виберіть країну номера. На нього ми надішлемо SMS із кодом підтвердження. Пробіли дозволені.",
    phoneCorrectionHelp: "Використайте email і пароль, указані під час реєстрації. Введіть новий номер і підтвердьте його через SMS.",
    phonePolicyLoading: "Завантажуємо вимоги до номера…"
  },
  fr: {
    swissPhonesOnly: "Numéros suisses uniquement pour l’inscription et le changement de numéro",
    swissPhonesOnlyHelp: "Un numéro suisse (+41) est requis pour l’inscription et le changement de numéro. Les comptes déjà vérifiés conservent leur accès.",
    swissPhoneHelp: "Utilisez un numéro suisse (+41). Nous y enverrons un code de vérification par SMS. Les espaces et le format national sont acceptés.",
    swissPhoneRequired: "Un numéro suisse valide (+41) est requis. Les numéros d’autres pays ne sont pas acceptés.",
    accountPhoneHelp: "Choisissez le pays du numéro. Nous y enverrons un code de vérification par SMS. Les espaces sont acceptés.",
    phoneCorrectionHelp: "Utilisez l’adresse e-mail et le mot de passe de votre inscription. Saisissez un nouveau numéro et vérifiez-le par SMS.",
    phonePolicyLoading: "Chargement des conditions relatives au numéro…"
  },
  it: {
    swissPhonesOnly: "Solo numeri svizzeri per la registrazione e il cambio di numero",
    swissPhonesOnlyHelp: "Per registrarsi e cambiare numero è richiesto un numero svizzero (+41). Gli account già verificati mantengono l’accesso.",
    swissPhoneHelp: "Usa un numero svizzero (+41). Invieremo un codice di verifica via SMS. Sono accettati spazi e formato nazionale.",
    swissPhoneRequired: "È richiesto un numero svizzero valido (+41). I numeri di altri paesi non sono accettati.",
    accountPhoneHelp: "Scegli il paese del numero. Invieremo un codice di verifica via SMS. Gli spazi sono accettati.",
    phoneCorrectionHelp: "Usa l’email e la password della registrazione. Inserisci un nuovo numero e verificalo via SMS.",
    phonePolicyLoading: "Caricamento dei requisiti del numero…"
  },
  rm: {
    swissPhonesOnly: "Mo numers svizzers per la registraziun e la midada dal numer",
    swissPhonesOnlyHelp: "Per sa registrar e midar il numer dovri in numer svizzer (+41). Contos gia confermads mantegnan lur access.",
    swissPhoneHelp: "Inditgescha in numer svizzer (+41). Nus tramettain in code da confermaziun per SMS. Spazis ed il format naziunal èn admess.",
    swissPhoneRequired: "I dovra in numer svizzer valaivel (+41). Numers d’auters pajais na vegnan betg acceptads.",
    accountPhoneHelp: "Tscherna il pajais dal numer. Nus tramettain in code da confermaziun per SMS. Spazis èn admess.",
    phoneCorrectionHelp: "Dovra l’e-mail ed il pled-clav da la registraziun. Endatescha in nov numer e conferma quel per SMS.",
    phonePolicyLoading: "Las pretensiuns al numer vegnan chargiadas…"
  }
};
