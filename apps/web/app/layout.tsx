import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { isUiLocale } from "@/lib/i18n/messages";
import { siteOrigin } from "@/lib/site-config";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin),
  title: "SHPROHLI — AI-assisted phone calls",
  description: "SHPROHLI helps people make everyday phone calls when speaking or the local language is a barrier.",
  applicationName: "SHPROHLI"
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
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('callassist_theme');document.documentElement.dataset.theme=t==='light'||t==='dark'?t:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')}catch(e){document.documentElement.dataset.theme='light'}})()` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
