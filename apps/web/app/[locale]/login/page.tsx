import type { Metadata } from "next";
import { LoginForm } from "@/components/auth-forms";

export const metadata: Metadata = {
  robots: { index: false, follow: false }
};

export default function LoginPage() {
  return <LoginForm />;
}
