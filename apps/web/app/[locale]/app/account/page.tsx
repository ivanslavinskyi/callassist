import type { Metadata } from "next";
import { AccountConsole } from "@/components/account-console";

export const metadata: Metadata = {
  title: "SHPROHLI account"
};

export default function AccountPage() {
  return <AccountConsole />;
}
