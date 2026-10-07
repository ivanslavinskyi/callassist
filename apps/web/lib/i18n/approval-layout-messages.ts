import type { UiLocale } from "@callassist/contracts";

export const approvalLayoutMessages: Record<UiLocale, { ready: string; help: string; details: string }> = {
  en: { ready: "Your plan is ready", help: "Review the plan, then approve it to start the call. You can still make changes.", details: "View the full call plan" },
  de: { ready: "Ihr Anrufplan ist bereit", help: "Prüfen Sie den Plan und geben Sie ihn frei, um den Anruf zu starten. Sie können ihn noch ändern.", details: "Vollständigen Anrufplan ansehen" },
  fr: { ready: "Votre plan d’appel est prêt", help: "Vérifiez le plan, puis approuvez-le pour lancer l’appel. Vous pouvez encore le modifier.", details: "Voir le plan d’appel complet" },
  it: { ready: "Il piano della chiamata è pronto", help: "Controlli il piano e lo approvi per avviare la chiamata. Può ancora modificarlo.", details: "Visualizza il piano completo" },
  rm: { ready: "Tes plan dal clom è pront", help: "Controllescha il plan e conferma el per cumenzar il clom. Ti pos anc al midar.", details: "Guardar il plan cumplet dal clom" },
  ru: { ready: "План звонка готов", help: "Проверьте план и подтвердите его, чтобы начать звонок. При необходимости вы можете его изменить.", details: "Посмотреть полный план звонка" },
  uk: { ready: "План дзвінка готовий", help: "Перевірте план і підтвердьте його, щоб розпочати дзвінок. За потреби ви можете його змінити.", details: "Переглянути повний план дзвінка" }
};
