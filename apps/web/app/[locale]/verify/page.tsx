import { VerificationForm } from "@/components/auth-forms";

export default async function VerifyPage({ searchParams }: {
  searchParams: Promise<{ email?: string | string[] }>;
}) {
  const email = (await searchParams).email;
  return <VerificationForm initialEmail={typeof email === "string" ? email : ""} />;
}
