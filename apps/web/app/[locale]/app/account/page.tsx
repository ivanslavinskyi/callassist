import type { Metadata } from "next";
import { AccountConsole } from "@/components/account-console";

export const metadata: Metadata = {
  title: "CallAssist account"
};

export default function AccountPage() {
  return <AccountConsole />;
}
