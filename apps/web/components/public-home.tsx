"use client";

import type {
  PublishedFaq,
  PublishedLanding,
  PublishedLandingBlock
} from "@callassist/contracts";
import { resolveUiLocale, selectableCallLanguagesForRole } from "@callassist/contracts";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { systemMessages } from "@/lib/i18n/system-messages";
import { ContentLocaleNotice } from "./content-locale-notice";
import { AppShell } from "./app-shell";
import { getCallLanguageLabel } from "@/lib/i18n/call-language-labels";
import { contentLanguageDirection } from "@/lib/content-localizations";
import { InteractiveCallDemo } from "./interactive-call-demo";
import { FaqList } from "./faq-list";
import { PublicFounderStory } from "./public-founder-story";
import { UiLocaleProvider, useUiLocale } from "./ui-locale-provider";
import { landingMessages } from "@/lib/i18n/landing-messages";
import type { SessionSnapshot } from "@/lib/session-state";
import { LandingPrimaryAction } from "./landing-primary-action";

export function PublicHome({
  landing,
  faq,
  initialSession
}: {
  landing: PublishedLanding;
  faq: PublishedFaq | null;
  initialSession: SessionSnapshot;
}) {
  const { localizeHref } = useUiLocale();

  return (
    <AppShell initialSession={initialSession}>
      <ContentLocaleNotice contentLocale={landing.locale} />
      <UiLocaleProvider locale={resolveUiLocale(landing.locale)} contentOnly>
      <PublicHomeContent
        faq={faq}
        landing={landing}
        showFounderStory
        sessionAware
        registerHref={localizeHref("/register")}
      />
      </UiLocaleProvider>
    </AppShell>
  );
}

export function PublicHomeContent({
  landing,
  faq,
  previewBanner,
  showFounderStory = false,
  sessionAware = false,
  registerHref
}: {
  landing: PublishedLanding;
  faq: PublishedFaq | null;
  previewBanner?: ReactNode;
  showFounderStory?: boolean;
  sessionAware?: boolean;
  registerHref: string;
}) {
  const [demoRun, setDemoRun] = useState(0);
  const example = landing.blocks.find((item) => item.blockType === "example");
  const heroAvailable = landing.blocks.some((item) => item.blockType === "hero");
  return (
    <main className="public-home" id="main-content" tabIndex={-1} lang={landing.locale} dir={contentLanguageDirection(landing.locale)}>
      {previewBanner}
      {landing.blocks.map((block) => showFounderStory && block.blockType === "problem" ? (
        <PublicFounderStory headingId={`landing-${block.id}`} key={block.id} />
      ) : (
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
          sessionAware={sessionAware}
          registerHref={registerHref}
        />
      ))}
    </main>
  );
}

function LandingBlockView({ block, faq, locale, registerHref, sessionAware, exampleTitle, heroAvailable, demoRun, onDemoStart, creditsAvailable }: {
  sessionAware: boolean;
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
          <h1>{block.title}</h1>
          {block.supportingTitle ? <p className="public-hero-support"><strong>{block.supportingTitle}</strong></p> : null}
          <p>{block.lead}</p>
          {block.secondaryText ? <p className="public-hero-secondary">{block.secondaryText}</p> : null}
          <div className="public-actions">
            <LandingPrimaryAction className="primary-button compact-button" locale={interfaceLocale} guestHref={registerHref} guestLabel={block.primaryCtaLabel} sessionAware={sessionAware} />
            <Link className="secondary-button" href={exampleTitle !== undefined ? "#example" : "#how-it-works"} onClick={exampleTitle !== undefined ? onDemoStart : undefined}>
              {exampleTitle !== undefined ? block.secondaryCtaLabel : systemMessages[interfaceLocale].how}
            </Link>
          </div>
          <ul className="public-badges" aria-label={block.eyebrow}>
            {block.badges.map((badge) => <li key={badge}>{badge}</li>)}
          </ul>
          {creditsAvailable ? <p className="public-credit-details"><Link href="#beta-credits" lang={interfaceLocale}>{landingMessages[interfaceLocale].creditDetails}</Link></p> : null}
          </div>
          {exampleTitle !== undefined ? <InteractiveCallDemo key={`${interfaceLocale}:${demoRun}`} locale={interfaceLocale} registerHref={registerHref} sessionAware={sessionAware} title={exampleTitle} autoStart={demoRun > 0} /> : null}
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
      return heroAvailable ? null : <InteractiveCallDemo locale={interfaceLocale} registerHref={registerHref} sessionAware={sessionAware} title={block.title} />;
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
          <ul aria-label={systemMessages[interfaceLocale].languages}>
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
          <LandingPrimaryAction className="primary-button compact-button" locale={interfaceLocale} guestHref={registerHref} guestLabel={block.primaryCtaLabel} sessionAware={sessionAware} />
          <Link className="public-credit-details" href={localizeHref("/faq")} lang={interfaceLocale}>{landingMessages[interfaceLocale].creditDetails}</Link>
        </section>
      );
  }
}
