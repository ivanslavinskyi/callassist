import type { Metadata } from "next";
import { PublicHome } from "@/components/public-home";
import { isUiLocale } from "@/lib/i18n/messages";

export async function generateMetadata({ params }: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const german = isUiLocale(locale) && locale === "de";
  return {
    title: german
      ? "CallAssist — KI-Telefonassistenz unter Ihrer Kontrolle"
      : "CallAssist — AI phone assistance under your control",
    description: german
      ? "Begleitete KI-Telefonanrufe für Menschen mit Sprachbeeinträchtigung oder lokaler Sprachbarriere."
      : "Supervised AI phone calls for people with speech impairments or local-language barriers."
  };
}

export default function HomePage() {
  return <PublicHome />;
}
