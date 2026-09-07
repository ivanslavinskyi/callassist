import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminCallPreparationInspector } from "@/components/admin-call-preparation-inspector";

export const metadata: Metadata = {
  title: "SHPROHLI preparation Inspector",
  robots: { index: false, follow: false }
};

export default async function AdminCallPreparationInspectorPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    notFound();
  }
  return <AdminCallPreparationInspector preparationId={id} />;
}
