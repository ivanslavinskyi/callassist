import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { UiLocaleProvider } from "@/components/ui-locale-provider";
import { isUiLocale } from "@/lib/i18n/messages";

// The root layout reads the locale injected by middleware to render the correct
// server-side <html lang>. Keep localized routes request-rendered until the locale
// boundary owns the document element directly.
export const dynamic = "force-dynamic";

export default async function LocaleLayout({ children, params }: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isUiLocale(locale)) notFound();
  return <UiLocaleProvider locale={locale}>{children}</UiLocaleProvider>;
}
