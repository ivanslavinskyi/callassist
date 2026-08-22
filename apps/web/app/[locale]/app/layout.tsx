import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { authenticatedAppRedirect } from "@/lib/route-access";
import { getServerCurrentUser } from "@/lib/server-auth";

export const metadata: Metadata = {
  robots: { index: false, follow: false }
};

export default async function AuthenticatedAppLayout({ children, params }: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const [{ locale }, user] = await Promise.all([
    params,
    getServerCurrentUser()
  ]);
  const destination = authenticatedAppRedirect(user, locale);
  if (destination) redirect(destination);
  return children;
}
