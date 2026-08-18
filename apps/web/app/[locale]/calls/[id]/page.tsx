import { LiveCall } from "@/components/live-call";

export default async function CallPage({ params }: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id } = await params;
  return <LiveCall callId={id} />;
}
