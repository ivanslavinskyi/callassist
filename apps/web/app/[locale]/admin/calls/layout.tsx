import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AdminRouteBoundary } from "@/components/admin-route-boundary";
import { isUiLocale } from "@/lib/i18n/messages";

export default async function AdminCallsLayout({
  children,
  params
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isUiLocale(locale)) notFound();
  return (
    <AdminRouteBoundary locale={locale} scope="operations">
      {children}
    </AdminRouteBoundary>
  );
}
