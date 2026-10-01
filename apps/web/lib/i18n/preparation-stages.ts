import type { CallPreparation, UiLocale } from "@callassist/contracts";
type Stage = NonNullable<CallPreparation["stage"]>;
export const preparationStageMessages: Record<UiLocale, Record<Stage, string>> = {
  en: { input_moderation:"Checking your request…", compilation:"Preparing your call plan…", compilation_repair:"Refining the plan after checking its details…", language_audit:"Checking the plan’s call language…", output_moderation:"Completing the final safety check…" },
  de: { input_moderation:"Ihre Anfrage wird geprüft…", compilation:"Ihr Anrufplan wird erstellt…", compilation_repair:"Die geprüften Angaben werden im Plan verbessert…", language_audit:"Die Gesprächssprache des Plans wird geprüft…", output_moderation:"Die abschliessende Sicherheitsprüfung läuft…" },
  fr: { input_moderation:"Vérification de votre demande…", compilation:"Préparation de votre plan d’appel…", compilation_repair:"Ajustement du plan après vérification des détails…", language_audit:"Vérification de la langue du plan…", output_moderation:"Dernière vérification de sécurité…" },
  it: { input_moderation:"Verifica della richiesta…", compilation:"Preparazione del piano della chiamata…", compilation_repair:"Correzione del piano dopo la verifica dei dettagli…", language_audit:"Verifica della lingua del piano…", output_moderation:"Verifica finale di sicurezza…" },
  rm: { input_moderation:"Vossa dumonda vegn controllada…", compilation:"Voss plan da telefon vegn preparà…", compilation_repair:"Il plan vegn adattà suenter la controlla dals detagls…", language_audit:"La lingua dal plan vegn controllada…", output_moderation:"La controlla finala da segirezza vegn fatga…" },
  ru: { input_moderation:"Проверяем ваш запрос…", compilation:"Готовим план звонка…", compilation_repair:"Уточняем план после проверки деталей…", language_audit:"Проверяем язык плана звонка…", output_moderation:"Завершаем проверку безопасности…" },
  uk: { input_moderation:"Перевіряємо ваш запит…", compilation:"Готуємо план дзвінка…", compilation_repair:"Уточнюємо план після перевірки деталей…", language_audit:"Перевіряємо мову плану дзвінка…", output_moderation:"Завершуємо перевірку безпеки…" }
};
