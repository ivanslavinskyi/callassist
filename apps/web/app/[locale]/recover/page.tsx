import type { Metadata } from "next";
import { PasswordRecoveryForm } from "@/components/auth-forms";

export const metadata: Metadata = {
  robots: { index: false, follow: false }
};

export default function PasswordRecoveryPage() {
  return <PasswordRecoveryForm />;
}
