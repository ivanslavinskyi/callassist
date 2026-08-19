import type { Metadata } from "next";
import { RecipientOptOutForm } from "@/components/recipient-opt-out-form";

export const metadata: Metadata = {
  title: "Stop CallAssist calls",
  description: "Verify your phone number and stop future CallAssist calls."
};

export default function RecipientOptOutPage() {
  return <RecipientOptOutForm />;
}
