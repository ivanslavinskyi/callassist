import type { UiLocale } from "@callassist/contracts";
export const privacyMessages = {
  de: { notice: "Wir verwenden Cookies und Statistiken, um deine Bedürfnisse besser zu verstehen.", acknowledge: "Alles klar" },
  fr: { notice: "Nous utilisons des cookies et des statistiques pour mieux comprendre vos besoins.", acknowledge: "Compris" },
  it: { notice: "Usiamo cookie e statistiche per capire meglio le tue esigenze.", acknowledge: "Va bene" },
  rm: { notice: "Nus utilisain cookies e statisticas per chapir meglier tes basegns.", acknowledge: "Tut cler" },
  en: { notice: "We use cookies and statistics to better understand your needs.", acknowledge: "Got it" },
  ru: { notice: "Мы используем cookies и статистику, чтобы лучше понимать ваши потребности.", acknowledge: "Всё ясно" },
  uk: { notice: "Ми використовуємо cookies і статистику, щоб краще розуміти ваші потреби.", acknowledge: "Зрозуміло" }
} satisfies Record<UiLocale, { notice: string; acknowledge: string }>;
