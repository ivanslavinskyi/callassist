"use client";

import type { PublishedFaq, PublishedLanding } from "@callassist/contracts";
import Link from "next/link";
import { AppShell } from "./app-shell";
import { PublicHomeContent } from "./public-home";

export function LandingDraftPreview({
  faq,
  interfaceLocale,
  landing
}: {
  faq: PublishedFaq | null;
  interfaceLocale: "en" | "de";
  landing: PublishedLanding;
}) {
  const isGerman = interfaceLocale === "de";
  const editorHref = `/${interfaceLocale}/admin/content/editorial`;
  return (
    <AppShell>
      <PublicHomeContent
        faq={faq}
        landing={landing}
        previewBanner={(
          <div className="content-preview-banner" role="status">
            <div>
              <strong>{isGerman ? "Private Entwurfsvorschau" : "Private draft preview"}</strong>
              <span>{isGerman ? "Nicht öffentlich sichtbar" : "Not visible to the public"}</span>
            </div>
            <Link href={editorHref}>
              {isGerman ? "Zurück zum Editor" : "Back to editor"}
            </Link>
          </div>
        )}
        registerHref={`/${interfaceLocale}/register`}
      />
    </AppShell>
  );
}
