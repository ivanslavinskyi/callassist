import { notFound, redirect } from "next/navigation";
import { getServerCurrentUser } from "@/lib/server-auth";
import { isUiLocale } from "@/lib/i18n/messages";
import { AuthFrame } from "@/components/auth-forms";
import { EmailVerificationForm } from "@/components/email-verification-form";
import { emailVerificationMessages } from "@/lib/i18n/email-verification-messages";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return { title: `${emailVerificationMessages[isUiLocale(locale) ? locale : "en"].title} | SHPROHLI`, robots: { index: false, follow: false } };
}
export default async function VerifyEmailPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isUiLocale(locale)) notFound();
  const user = await getServerCurrentUser();
  if (!user) redirect(`/${locale}/login`);
  return <AuthFrame><EmailVerificationForm initialUser={user} /></AuthFrame>;
}
