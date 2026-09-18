import type { Metadata } from "next";
import { AdminUsersConsole } from "@/components/admin-users-console";

export const metadata: Metadata = {
  title: "SHPROHLI user operations",
  robots: { index: false, follow: false }
};

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<{ userId?: string }> }) {
  const { userId } = await searchParams;
  const initialUserId = typeof userId === "string" && /^[0-9a-f-]{36}$/i.test(userId) ? userId : undefined;
  return <AdminUsersConsole initialUserId={initialUserId} />;
}
