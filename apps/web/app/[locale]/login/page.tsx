import type { Metadata } from "next";
import { LoginForm } from "@/components/auth-forms";
import { notFound, redirect } from "next/navigation";
import { getServerCurrentUser } from "@/lib/server-auth";
import { isUiLocale } from "@/lib/i18n/messages";
import { callResultReturnPath } from "@/lib/auth-return-path";

export const metadata: Metadata = {
  robots: { index: false, follow: false }
};

export default async function LoginPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ returnTo?: string | string[] }> }) {
  const { locale } = await params;
  if (!isUiLocale(locale)) notFound();
  const returnTo = callResultReturnPath((await searchParams).returnTo);
  if (await getServerCurrentUser()) redirect(returnTo ?? `/${locale}/app`);
  return <LoginForm returnTo={returnTo} />;
}
