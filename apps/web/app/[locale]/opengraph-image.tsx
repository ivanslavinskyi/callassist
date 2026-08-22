import { ImageResponse } from "next/og";
import { isUiLocale } from "@/lib/i18n/messages";
import { getPublishedLanding } from "@/lib/server-content";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage({ params }: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: value } = await params;
  const locale = isUiLocale(value) ? value : "en";
  const landing = await getPublishedLanding(locale);
  const hero = landing?.blocks.find(({ blockType }) => blockType === "hero");
  const headline = hero?.blockType === "hero"
    ? hero.title
    : locale === "de"
      ? "KI-Telefonassistenz unter Ihrer Kontrolle"
      : "AI phone assistance under your control";
  const strapline = hero?.blockType === "hero"
    ? hero.badges.join(" · ")
    : locale === "de"
      ? "Barrierefrei · begleitet · nur Schweiz"
      : "Accessible · supervised · Switzerland only";
  return new ImageResponse(
    <div style={{
      alignItems: "stretch",
      background: "#eef4ef",
      color: "#15211d",
      display: "flex",
      flexDirection: "column",
      height: "100%",
      justifyContent: "space-between",
      padding: "72px 80px",
      width: "100%"
    }}>
      <div style={{ color: "#168553", display: "flex", fontSize: 30, fontWeight: 800 }}>
        CallAssist
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        <div style={{ display: "flex", fontSize: 68, fontWeight: 800, letterSpacing: "-3px", lineHeight: 1.05, maxWidth: 980 }}>
          {headline}
        </div>
        <div style={{ color: "#59645f", display: "flex", fontSize: 27 }}>
          {strapline}
        </div>
      </div>
      <div style={{ alignItems: "center", display: "flex", fontSize: 22, justifyContent: "space-between" }}>
        <span>callassist</span>
        <span style={{ color: "#168553" }}>{locale.toUpperCase()} · Public beta</span>
      </div>
    </div>,
    size
  );
}
