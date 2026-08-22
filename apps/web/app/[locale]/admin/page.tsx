import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminOperationsDashboard } from "@/components/admin-operations-dashboard";
import { AdminRouteBoundary } from "@/components/admin-route-boundary";
import { isUiLocale } from "@/lib/i18n/messages";

export const metadata: Metadata = {
  title: "CallAssist operations overview",
  robots: { index: false, follow: false }
};

export default async function AdminOverviewPage({ params }: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isUiLocale(locale)) notFound();
  return (
    <AdminRouteBoundary locale={locale} scope="operations">
      <AdminOperationsDashboard />
    </AdminRouteBoundary>
  );
}
