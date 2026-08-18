import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { isUiLocale } from "@/lib/i18n/messages";
import "./globals.css";

export const metadata: Metadata = {
  title: "CallAssist — controlled AI phone calls",
  description: "A personal voice assistant with live transcripts and approval gates"
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const requestedLocale = (await headers()).get("x-callassist-ui-locale") ?? "en";
  const locale = isUiLocale(requestedLocale) ? requestedLocale : "en";
  return (
    <html lang={locale}>
      <body>{children}</body>
    </html>
  );
}
