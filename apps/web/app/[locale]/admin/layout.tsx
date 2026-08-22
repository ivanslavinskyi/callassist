import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { adminAreaRedirect } from "@/lib/route-access";
import { getServerCurrentUser } from "@/lib/server-auth";

export const metadata: Metadata = {
  robots: { index: false, follow: false }
};

export default async function AdminLayout({ children, params }: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const [{ locale }, user] = await Promise.all([
    params,
    getServerCurrentUser()
  ]);
  const destination = adminAreaRedirect(user, locale);
  if (destination) redirect(destination);
  return children;
}
