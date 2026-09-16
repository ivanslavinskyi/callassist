import type { Metadata } from "next";
import { LoginForm } from "@/components/auth-forms";
import { notFound, redirect } from "next/navigation";
import { getServerCurrentUser } from "@/lib/server-auth";
import { isUiLocale } from "@/lib/i18n/messages";

export const metadata: Metadata = {
  robots: { index: false, follow: false }
};

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isUiLocale(locale)) notFound();
  if (await getServerCurrentUser()) redirect(`/${locale}/app`);
  return <LoginForm />;
}
