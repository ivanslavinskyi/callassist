import type { Metadata } from "next";
import { VerificationForm } from "@/components/auth-forms";

export const metadata: Metadata = {
  robots: { index: false, follow: false }
};

export default async function VerifyPage({ searchParams }: {
  searchParams: Promise<{ email?: string | string[] }>;
}) {
  const email = (await searchParams).email;
  return <VerificationForm initialEmail={typeof email === "string" ? email : ""} />;
}
