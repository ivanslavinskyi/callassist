import type { Metadata } from "next";
import { LiveCall } from "@/components/live-call";

export const metadata: Metadata = {
  title: "SHPROHLI call detail"
};

export default async function CallPage({ params }: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id } = await params;
  return <LiveCall callId={id} />;
}
