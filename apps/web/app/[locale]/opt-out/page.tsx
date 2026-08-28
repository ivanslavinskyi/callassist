import type { Metadata } from "next";
import { RecipientOptOutForm } from "@/components/recipient-opt-out-form";

export const metadata: Metadata = {
  title: "Stop SHPROHLI calls",
  description: "Verify your phone number and stop future SHPROHLI calls."
};

export default function RecipientOptOutPage() {
  return <RecipientOptOutForm />;
}
