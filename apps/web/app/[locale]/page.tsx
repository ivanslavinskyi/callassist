import type { Metadata } from "next";
import { PublicHome } from "@/components/public-home";
import { isUiLocale } from "@/lib/i18n/messages";
import { homeMetadata } from "@/lib/seo-metadata";

export async function generateMetadata({ params }: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return homeMetadata(isUiLocale(locale) ? locale : "en");
}

export default function HomePage() {
  return <PublicHome />;
}
