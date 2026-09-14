"use client";

import type {
  PublishedFaq,
  PublishedLanding,
  PublishedLandingBlock
} from "@callassist/contracts";
import { selectableCallLanguagesForRole } from "@callassist/contracts";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { AppShell } from "./app-shell";
import { getCallLanguageLabel } from "@/lib/i18n/call-language-labels";
import { contentLanguageDirection } from "@/lib/content-localizations";
import { InteractiveCallDemo } from "./interactive-call-demo";
import { FaqList } from "./faq-list";
import { useUiLocale } from "./ui-locale-provider";
import { landingMessages } from "@/lib/i18n/landing-messages";

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
  const [demoRun, setDemoRun] = useState(0);
  const example = landing.blocks.find((item) => item.blockType === "example");
  const heroAvailable = landing.blocks.some((item) => item.blockType === "hero");
  return (
    <main className="public-home" id="main-content" tabIndex={-1} lang={landing.locale} dir={contentLanguageDirection(landing.locale)}>
      {previewBanner}
      {landing.blocks.map((block) => (
        <LandingBlockView
          block={block}
          exampleTitle={example?.title}
          heroAvailable={heroAvailable}
          demoRun={demoRun}
          onDemoStart={() => setDemoRun(value => value + 1)}
          creditsAvailable={landing.blocks.some((item) => item.blockType === "cta")}
          faq={faq}
          key={block.id}
          locale={landing.locale}
          registerHref={registerHref}
        />
      ))}
    </main>
  );
}

function LandingBlockView({ block, faq, locale, registerHref, exampleTitle, heroAvailable, demoRun, onDemoStart, creditsAvailable }: {
  exampleTitle?: string;
  heroAvailable: boolean;
  demoRun: number;
  onDemoStart: () => void;
  creditsAvailable: boolean;
  block: PublishedLandingBlock;
  faq: PublishedFaq | null;
  locale: PublishedLanding["locale"];
  registerHref: string;
}) {
  const { locale: interfaceLocale, localizeHref } = useUiLocale();
  switch (block.blockType) {
    case "hero":
      return (
        <section className={`public-hero${exampleTitle !== undefined ? " public-hero-interactive" : ""}`}>
          <div className="public-hero-copy">
          <span className="eyebrow">{block.eyebrow}</span>
          <h1><HeroTitle title={block.title} locale={locale} /></h1>
          {block.supportingTitle ? <p className="public-hero-support"><strong>{block.supportingTitle}</strong></p> : null}
          <p>{block.lead}</p>
          {block.secondaryText ? <p className="public-hero-secondary">{block.secondaryText}</p> : null}
          <div className="public-actions">
            <Link className="primary-button compact-button" href={registerHref}>{block.primaryCtaLabel}</Link>
            <Link className="secondary-button" href={exampleTitle !== undefined ? "#example" : "#how-it-works"} onClick={exampleTitle !== undefined ? onDemoStart : undefined}>
              {exampleTitle !== undefined ? block.secondaryCtaLabel : locale === "de" ? "So funktioniert es" : "See how it works"}
            </Link>
          </div>
          <ul className="public-badges" aria-label={block.eyebrow}>
            {block.badges.map((badge) => <li key={badge}>{badge}</li>)}
          </ul>
          {creditsAvailable ? <p className="public-credit-details"><Link href="#beta-credits" lang={interfaceLocale}>{landingMessages[interfaceLocale].creditDetails}</Link></p> : null}
          </div>
          {exampleTitle !== undefined ? <InteractiveCallDemo key={`${interfaceLocale}:${demoRun}`} locale={interfaceLocale} registerHref={registerHref} title={exampleTitle} autoStart={demoRun > 0} /> : null}
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
      // The CMS example block now lives in the hero. Keep a standalone fallback when the hero is disabled.
      return heroAvailable ? null : <InteractiveCallDemo locale={interfaceLocale} registerHref={registerHref} title={block.title} />;
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
            {selectableCallLanguagesForRole().map((language) => (
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
        <section className="public-final-cta" id="beta-credits" tabIndex={-1}>
          <div>
            <h2>{block.title}</h2>
            <p>{block.text}</p>
          </div>
          <Link className="primary-button compact-button" href={registerHref}>{block.primaryCtaLabel}</Link>
          <Link className="public-credit-details" href={localizeHref("/faq")} lang={interfaceLocale}>{landingMessages[interfaceLocale].creditDetails}</Link>
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
