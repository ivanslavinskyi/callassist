import type { Metadata } from "next";
import { PromoRedemptionForm } from "@/components/promo-redemption-form";

export const metadata: Metadata = {
  title: "Redeem SHPROHLI credits",
  robots: { index: false, follow: false }
};

export default function RedeemPage() {
  return <PromoRedemptionForm />;
}
