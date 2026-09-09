"use client";

import type {
  PublishedFaq,
  PublishedLanding,
  PublishedLandingBlock
} from "@callassist/contracts";
import { SELECTABLE_CALL_LANGUAGES } from "@callassist/contracts";
import Link from "next/link";
import type { ReactNode } from "react";
import { AppShell } from "./app-shell";
import { getCallLanguageLabel } from "@/lib/i18n/call-language-labels";
import { contentLanguageDirection } from "@/lib/content-localizations";
import { LandingDemo, LandingDemoPreview } from "./landing-demo";
import { FaqList } from "./faq-list";
import { useUiLocale } from "./ui-locale-provider";

export function PublicHome({
  landing,
  faq
}: {
  landing: PublishedLanding;
  faq: PublishedFaq | null;
}) {
  const { localizeHref } = useUiLocale();

  return (
    <AppShell>
      <PublicHomeContent
        faq={faq}
        landing={landing}
        registerHref={localizeHref("/register")}
      />
    </AppShell>
  );
}

export function PublicHomeContent({
  landing,
  faq,
  previewBanner,
  registerHref
}: {
  landing: PublishedLanding;
  faq: PublishedFaq | null;
  previewBanner?: ReactNode;
  registerHref: string;
}) {
  return (
    <main className="public-home" id="main-content" tabIndex={-1} lang={landing.locale} dir={contentLanguageDirection(landing.locale)}>
      {previewBanner}
      {landing.blocks.map((block) => (
        <LandingBlockView
          block={block}
          exampleAvailable={landing.blocks.some((item) => item.blockType === "example")}
          faq={faq}
          key={block.id}
          locale={landing.locale}
          registerHref={registerHref}
        />
      ))}
    </main>
  );
}

function LandingBlockView({ block, faq, locale, registerHref, exampleAvailable }: {
  exampleAvailable: boolean;
  block: PublishedLandingBlock;
  faq: PublishedFaq | null;
  locale: PublishedLanding["locale"];
  registerHref: string;
}) {
  const { locale: interfaceLocale } = useUiLocale();
  switch (block.blockType) {
    case "hero":
      return (
        <section className="public-hero">
          <div className="public-hero-copy">
          <span className="eyebrow">{block.eyebrow}</span>
          <h1><HeroTitle title={block.title} locale={locale} /></h1>
          {block.supportingTitle ? <p className="public-hero-support"><strong>{block.supportingTitle}</strong></p> : null}
          <p>{block.lead}</p>
          {block.secondaryText ? <p className="public-hero-secondary">{block.secondaryText}</p> : null}
          <div className="public-actions">
            <Link className="primary-button compact-button" href={registerHref}>{block.primaryCtaLabel}</Link>
            <Link className="secondary-button" href={exampleAvailable ? "#example" : "#how-it-works"}>
              {exampleAvailable ? block.secondaryCtaLabel : locale === "de" ? "So funktioniert es" : "See how it works"}
            </Link>
          </div>
          <ul className="public-badges" aria-label={block.eyebrow}>
            {block.badges.map((badge) => <li key={badge}>{badge}</li>)}
          </ul>
          </div>
          <div lang={interfaceLocale}><LandingDemoPreview locale={interfaceLocale} /></div>
        </section>
      );
    case "problem":
      return (
        <section className="public-section public-problem" aria-labelledby={`landing-${block.id}`}>
          <span className="eyebrow">{block.eyebrow}</span>
          <h2 id={`landing-${block.id}`}>{block.title}</h2>
          <div className="public-problem-grid">
            {block.items.map((item) => (
              <article key={item.title}>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
        </section>
      );
    case "how_it_works":
      return (
        <section className="public-section" id="how-it-works" aria-labelledby={`landing-${block.id}`}>
          <span className="eyebrow">{block.eyebrow}</span>
          <h2 id={`landing-${block.id}`}>{block.title}</h2>
          <ol className="public-steps">
            {block.steps.map((step, index) => (
              <li key={step.id}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </li>
            ))}
          </ol>
        </section>
      );
    case "use_cases":
      return (
        <section className="public-section public-use-cases" aria-labelledby={`landing-${block.id}`}>
          <div>
            <span className="eyebrow">{block.eyebrow}</span>
            <h2 id={`landing-${block.id}`}>{block.title}</h2>
            <p>{block.text}</p>
          </div>
          <ul>
            {block.items.map((item) => (
              <li key={item.title}>
                <h3>{item.title}</h3>
                {item.text ? <p>{item.text}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      );
    case "example":
      return <div lang={interfaceLocale}><LandingDemo locale={interfaceLocale} title={block.title} /></div>;
    case "safety_privacy":
      return (
        <section className="public-section public-safety" aria-labelledby={`landing-${block.id}`}>
          <div className="public-safety-heading">
            <span className="eyebrow">{block.eyebrow}</span>
            <h2 id={`landing-${block.id}`}>{block.title}</h2>
          </div>
          <ul className="public-safety-points">
            {block.limits.map((item) => <li key={item}>{item}</li>)}
          </ul>
          <p className="public-safety-scope">{block.text}</p>
        </section>
      );
    case "languages":
      return (
        <section className="public-section public-language">
          <h2>{block.title}</h2>
          <p>{block.text}</p>
          <ul aria-label={locale === "de" ? "Unterstützte Gesprächssprachen" : "Supported call languages"}>
            {SELECTABLE_CALL_LANGUAGES.map((language) => (
              <li key={language.locale}>
                <span>{language.shortLabel}</span>
                <span lang={interfaceLocale}>{getCallLanguageLabel(language.locale, interfaceLocale)}</span>
              </li>
            ))}
          </ul>
        </section>
      );
    case "faq":
      return (
        <section className="public-section public-faq" aria-labelledby={`landing-${block.id}`}>
          <span className="eyebrow">{block.eyebrow}</span>
          <h2 id={`landing-${block.id}`}>{block.title}</h2>
          {faq ? <div lang={faq.locale} dir={contentLanguageDirection(faq.locale)}><FaqList items={faq.items.slice(0, block.itemLimit)} /></div> : null}
        </section>
      );
    case "cta":
      return (
        <section className="public-final-cta">
          <div>
            <h2>{block.title}</h2>
            <p>{block.text}</p>
          </div>
          <Link className="primary-button compact-button" href={registerHref}>{block.primaryCtaLabel}</Link>
        </section>
      );
  }
}

function HeroTitle({ title, locale }: { title: string; locale: string }) {
  const word = locale === "de" ? "Sprechen" : "speaking";
  const index = title.indexOf(word);
  if (index < 0) return title;
  return <>{title.slice(0, index)}<span className="accent">{word}</span>{title.slice(index + word.length)}</>;
}
