"use client";

import type {
  PublishedFaq,
  PublishedLanding,
  PublishedLandingBlock
} from "@callassist/contracts";
import { SUPPORTED_CALL_LANGUAGES } from "@callassist/contracts";
import Link from "next/link";
import type { ReactNode } from "react";
import { AppShell } from "./app-shell";
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
    <main className="public-home" id="main-content" tabIndex={-1}>
      {previewBanner}
      {landing.blocks.map((block) => (
        <LandingBlockView
          block={block}
          faq={faq}
          key={block.id}
          locale={landing.locale}
          registerHref={registerHref}
        />
      ))}
    </main>
  );
}

function LandingBlockView({ block, faq, locale, registerHref }: {
  block: PublishedLandingBlock;
  faq: PublishedFaq | null;
  locale: PublishedLanding["locale"];
  registerHref: string;
}) {
  switch (block.blockType) {
    case "hero":
      return (
        <section className="public-hero">
          <span className="eyebrow">{block.eyebrow}</span>
          <h1>{block.title}</h1>
          {block.supportingTitle ? <p className="public-hero-support"><strong>{block.supportingTitle}</strong></p> : null}
          <p>{block.lead}</p>
          {block.secondaryText ? <p className="public-hero-secondary">{block.secondaryText}</p> : null}
          <div className="public-actions">
            <Link className="primary-button compact-button" href={registerHref}>{block.primaryCtaLabel}</Link>
            <Link className="secondary-button" href="#how-it-works">{block.secondaryCtaLabel}</Link>
          </div>
          <ul className="public-badges" aria-label={block.eyebrow}>
            {block.badges.map((badge) => <li key={badge}>{badge}</li>)}
          </ul>
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
                <span>{index + 1}</span>
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
      return (
        <section className="public-section public-example" aria-labelledby={`landing-${block.id}`}>
          <h2 id={`landing-${block.id}`}>{block.title}</h2>
          <ol>
            {block.items.map((item, index) => (
              <li key={item.title}>
                <span>{index + 1}</span>
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      );
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
            {SUPPORTED_CALL_LANGUAGES.map((language) => (
              <li key={language.locale}>
                <span>{language.shortLabel}</span>
                {displayLanguageName(language.locale, language.label, locale)}
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
          {faq ? <FaqList items={faq.items.slice(0, block.itemLimit)} /> : null}
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

function displayLanguageName(
  callLocale: string,
  fallback: string,
  locale: PublishedLanding["locale"]
) {
  try {
    return new Intl.DisplayNames(locale === "de" ? ["de-CH"] : ["en"], {
      type: "language"
    }).of(callLocale) ?? fallback;
  } catch {
    return fallback;
  }
}
