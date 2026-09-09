import { landingDemo } from "@/lib/landing-demo";
import type { UiLocale } from "@/lib/i18n/messages";
import { CallPlanPresentation } from "./call-plan-presentation";
import { CallSummaryPresentation } from "./call-summary-presentation";
import styles from "./landing-demo.module.css";

export function LandingDemoPreview({ locale }: { locale: UiLocale }) {
  const demo = landingDemo[locale];
  return <aside className={`hero-example ${styles.preview}`} aria-label={demo.educationalLabel}>
    <span className="eyebrow">{demo.educationalLabel}</span>
    <h3>{demo.recipient}</h3>
    <p>{demo.plan.localizedObjective}</p>
    <h4>{demo.questionsLabel}</h4>
    <ol>{demo.plan.orderedQuestions.map((question, index) =>
      <li key={index}><div><p>{question.text}</p></div></li>
    )}</ol>
    <h4>{demo.factsLabel}</h4>
    <ul>{demo.plan.approvedFacts.map((fact, index) => <li key={index}>{fact.callLanguageText}</li>)}</ul>
  </aside>;
}

export function LandingDemo({ locale, title }: { locale: UiLocale; title: string }) {
  const demo = landingDemo[locale];
  return <section className={`public-section ${styles.demo}`} id="example" aria-labelledby="landing-demo-title">
    <span className="eyebrow">{demo.educationalLabel}</span>
    <h2 id="landing-demo-title">{title}</h2>
    <p>{demo.educationalNote}</p>
    <div className={styles.grid}>
      <section className={styles.request}>
        <h3>{demo.requestLabel}</h3>
        <p>{demo.request}</p>
      </section>
      <section className={styles.plan}>
        <h3>{demo.planLabel}</h3>
        <CallPlanPresentation plan={demo.plan} uiLocale={locale} headingLevel={4} />
      </section>
      <section className={styles.excerpt}>
        <h3>{demo.excerptLabel}</h3>
        <p>{demo.excerptNote}</p>
        <ol>{demo.excerpt.map((segment, index) => <li key={index} id={`landing-demo-${index}`} tabIndex={-1}>
          <strong>{segment.speaker}</strong><p>{segment.text}</p>
        </li>)}</ol>
      </section>
      <section className={styles.outcome}>
        <h3>{demo.outcomeLabel}</h3>
        <CallSummaryPresentation summary={demo.summary} uiLocale={locale} headingLevel={4}
          sourceHref={(id) => `#landing-${id}`} />
      </section>
    </div>
  </section>;
}
