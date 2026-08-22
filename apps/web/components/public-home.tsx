"use client";

import Link from "next/link";
import { AppShell } from "./app-shell";
import { useUiLocale } from "./ui-locale-provider";
import { publicMessages } from "@/lib/i18n/public-messages";

export function PublicHome() {
  const { locale, localizeHref } = useUiLocale();
  const copy = publicMessages[locale];

  return (
    <AppShell>
      <main className="public-home" id="main-content" tabIndex={-1}>
        <section className="public-hero">
          <span className="eyebrow">{copy.eyebrow}</span>
          <h1>{copy.title}</h1>
          <p>{copy.lead}</p>
          <div className="public-actions">
            <Link className="primary-button compact-button" href={localizeHref("/register")}>{copy.tryBeta}</Link>
            <Link className="secondary-button" href={localizeHref("/login")}>{copy.signIn}</Link>
          </div>
          <ul className="public-badges" aria-label={copy.eyebrow}>
            {copy.badges.map((badge) => <li key={badge}>{badge}</li>)}
          </ul>
        </section>

        <section className="public-section" aria-labelledby="how-it-works">
          <span className="eyebrow">{copy.howEyebrow}</span>
          <h2 id="how-it-works">{copy.howTitle}</h2>
          <ol className="public-steps">
            {copy.steps.map((step, index) => (
              <li key={step.title}>
                <span>{index + 1}</span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="public-section public-safety" aria-labelledby="safety-boundaries">
          <div>
            <span className="eyebrow">{copy.safetyEyebrow}</span>
            <h2 id="safety-boundaries">{copy.safetyTitle}</h2>
            <p>{copy.safetyText}</p>
          </div>
          <div className="public-use-grid">
            <article>
              <h3>{copy.usesTitle}</h3>
              <ul>{copy.uses.map((item) => <li key={item}>{item}</li>)}</ul>
            </article>
            <article>
              <h3>{copy.limitsTitle}</h3>
              <ul>{copy.limits.map((item) => <li key={item}>{item}</li>)}</ul>
            </article>
          </div>
        </section>

        <section className="public-section public-language">
          <h2>{copy.languagesTitle}</h2>
          <p>{copy.languagesText}</p>
        </section>

        <section className="public-final-cta">
          <div>
            <h2>{copy.finalTitle}</h2>
            <p>{copy.finalText}</p>
          </div>
          <Link className="primary-button compact-button" href={localizeHref("/register")}>{copy.tryBeta}</Link>
        </section>
      </main>
    </AppShell>
  );
}
