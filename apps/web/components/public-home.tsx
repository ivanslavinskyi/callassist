"use client";

import type {
  PublishedFaq,
  PublishedLanding,
  PublishedLandingBlock
} from "@callassist/contracts";
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
        loginHref={localizeHref("/login")}
        registerHref={localizeHref("/register")}
      />
    </AppShell>
  );
}

export function PublicHomeContent({
  landing,
  faq,
  loginHref,
  previewBanner,
  registerHref
}: {
  landing: PublishedLanding;
  faq: PublishedFaq | null;
  loginHref: string;
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
          loginHref={loginHref}
          registerHref={registerHref}
        />
      ))}
    </main>
  );
}

function LandingBlockView({ block, faq, loginHref, registerHref }: {
  block: PublishedLandingBlock;
  faq: PublishedFaq | null;
  loginHref: string;
  registerHref: string;
}) {
  switch (block.blockType) {
    case "hero":
      return (
        <section className="public-hero">
          <span className="eyebrow">{block.eyebrow}</span>
          <h1>{block.title}</h1>
          <p>{block.lead}</p>
          <div className="public-actions">
            <Link className="primary-button compact-button" href={registerHref}>{block.primaryCtaLabel}</Link>
            <Link className="secondary-button" href={loginHref}>{block.secondaryCtaLabel}</Link>
          </div>
          <ul className="public-badges" aria-label={block.eyebrow}>
            {block.badges.map((badge) => <li key={badge}>{badge}</li>)}
          </ul>
        </section>
      );
    case "how_it_works":
      return (
        <section className="public-section" aria-labelledby={`landing-${block.id}`}>
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
            {block.items.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>
      );
    case "safety_privacy":
      return (
        <section className="public-section public-safety" aria-labelledby={`landing-${block.id}`}>
          <div>
            <span className="eyebrow">{block.eyebrow}</span>
            <h2 id={`landing-${block.id}`}>{block.title}</h2>
            <p>{block.text}</p>
          </div>
          <div className="public-use-grid">
            <article>
              <h3>{block.limitsTitle}</h3>
              <ul>{block.limits.map((item) => <li key={item}>{item}</li>)}</ul>
            </article>
          </div>
        </section>
      );
    case "languages":
      return (
        <section className="public-section public-language">
          <h2>{block.title}</h2>
          <p>{block.text}</p>
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
