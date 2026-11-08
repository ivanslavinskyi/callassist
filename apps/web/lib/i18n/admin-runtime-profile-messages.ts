import type { UiLocale } from "@callassist/contracts";

export const runtimeProfileMessages: Record<UiLocale, {
  title: string; ready: string; mismatch: string; compiler: string; policy: string; expected: string;
}> = {
  en: { title: "Call runtime profile", ready: "Runtime and preparation match", mismatch: "Runtime and preparation do not match. Deployment configuration needs attention.", compiler: "Plan compiler", policy: "Saved preparation policy", expected: "Required policy" },
  de: { title: "Laufzeitprofil für Anrufe", ready: "Laufzeit und Vorbereitung stimmen überein", mismatch: "Laufzeit und Vorbereitung stimmen nicht überein. Bitte die Bereitstellungskonfiguration prüfen.", compiler: "Plan-Compiler", policy: "Gespeicherte Vorbereitungsrichtlinie", expected: "Erforderliche Richtlinie" },
  fr: { title: "Profil d’exécution des appels", ready: "L’exécution et la préparation correspondent", mismatch: "L’exécution et la préparation ne correspondent pas. Vérifiez la configuration du déploiement.", compiler: "Compilateur de plan", policy: "Politique de préparation enregistrée", expected: "Politique requise" },
  it: { title: "Profilo di esecuzione delle chiamate", ready: "Esecuzione e preparazione corrispondono", mismatch: "Esecuzione e preparazione non corrispondono. Controllare la configurazione di distribuzione.", compiler: "Compilatore del piano", policy: "Politica di preparazione salvata", expected: "Politica richiesta" },
  rm: { title: "Profil d’execuziun dals cloms", ready: "Execuziun e preparaziun correspundan", mismatch: "Execuziun e preparaziun na correspundan betg. Controllai la configuraziun da publicaziun.", compiler: "Cumpilatur dal plan", policy: "Directiva da preparaziun memorisada", expected: "Directiva necessaria" },
  ru: { title: "Профиль рантайма звонков", ready: "Рантайм и подготовка согласованы", mismatch: "Рантайм и подготовка не совпадают. Проверьте конфигурацию развёртывания.", compiler: "Компилятор плана", policy: "Сохранённая политика подготовки", expected: "Требуемая политика" },
  uk: { title: "Профіль рантайму дзвінків", ready: "Рантайм і підготовку узгоджено", mismatch: "Рантайм і підготовка не збігаються. Перевірте конфігурацію розгортання.", compiler: "Компілятор плану", policy: "Збережена політика підготовки", expected: "Потрібна політика" }
};
