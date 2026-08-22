import type { Metadata } from "next";
import { RegistrationForm } from "@/components/auth-forms";

export const metadata: Metadata = {
  robots: { index: false, follow: false }
};

export default function RegisterPage() {
  return <RegistrationForm />;
}
