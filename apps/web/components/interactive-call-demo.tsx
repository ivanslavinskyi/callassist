"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import Link from "next/link";
import { demoMessages } from "@/lib/i18n/demo-messages";
import type { UiLocale } from "@/lib/i18n/registry";
import { buildDemoPdf, demoDelay, demoReducer, demoScenarioIds, demoStep, getDemoScenario, initialDemoState, type DemoScenarioId, type DemoTurn } from "@/lib/interactive-demo";
import { CallPlanPresentation } from "./call-plan-presentation";
import { CallSummaryPresentation } from "./call-summary-presentation";
import styles from "./interactive-call-demo.module.css";

export function InteractiveCallDemo({ locale, registerHref, autoStart = false, title }: { locale: UiLocale; registerHref: string; autoStart?: boolean; title?: string }) {
  const [scenario, setScenario] = useState<DemoScenarioId>("documents");
  const [generation, setGeneration] = useState(0);
  const copy = demoMessages[locale];
  return <section className={styles.window} id="example" aria-label={title ?? copy.label} lang={locale}>
    <DemoPlayer key={`${locale}:${scenario}:${generation}`} locale={locale} scenarioId={scenario} registerHref={registerHref} autoStart={autoStart && generation === 0} demoTitle={title}
      onScenario={setScenario} onReplay={() => setGeneration(value => value + 1)} />
  </section>;
}

function DemoPlayer({ locale, scenarioId, registerHref, autoStart, demoTitle, onScenario, onReplay }: {
  locale: UiLocale; scenarioId: DemoScenarioId; registerHref: string; autoStart: boolean;
  demoTitle?: string;
  onScenario: (id: DemoScenarioId) => void; onReplay: () => void;
}) {
  const copy = demoMessages[locale];
  const scenario = useMemo(() => getDemoScenario(locale, scenarioId), [locale, scenarioId]);
  const [state, dispatch] = useReducer(demoReducer, autoStart ? { ...initialDemoState, phase: "typing" as const } : initialDemoState);
  const [manual, setManual] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [view, setView] = useState<"summary" | "transcript">("transcript");
  const [summaryState, setSummaryState] = useState<"idle" | "loading" | "ready">("idle");
  const [exportState, setExportState] = useState<"idle" | "loading" | "error">("idle");
  const transcriptPanel = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const mounted = useRef(true);
  const sourceTarget = useRef<string | null>(null);
  const stage = demoStep(state.phase);
  const active = !["idle", "review", "result"].includes(state.phase);

  useEffect(() => {
    mounted.current = true;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setManual(motion.matches);
    const updateVisibility = () => setHidden(document.hidden);
    updateMotion(); updateVisibility();
    motion.addEventListener("change", updateMotion);
    document.addEventListener("visibilitychange", updateVisibility);
    return () => { mounted.current = false; motion.removeEventListener("change", updateMotion); document.removeEventListener("visibilitychange", updateVisibility); };
  }, []);
  useEffect(() => {
    if (!active || state.paused || manual || hidden) return;
    const timer = window.setTimeout(() => dispatch({ type: "tick", turnCount: scenario.turns.length }), demoDelay(state.phase));
    return () => window.clearTimeout(timer);
  }, [active, state.phase, state.tick, state.paused, manual, hidden, scenario.turns.length]);
  useEffect(() => {
    if (state.phase === "live" && following.current && transcriptPanel.current) transcriptPanel.current.scrollTop = transcriptPanel.current.scrollHeight;
  }, [state.phase, state.tick]);
  useEffect(() => {
    if (summaryState !== "loading" || hidden) return;
    const timer = window.setTimeout(() => setSummaryState("ready"), manual ? 0 : 1300);
    return () => window.clearTimeout(timer);
  }, [summaryState, hidden, manual]);
  useEffect(() => {
    if (view === "transcript" && sourceTarget.current) {
      const target = document.getElementById(sourceTarget.current);
      if (target && transcriptPanel.current) transcriptPanel.current.scrollTop = target.offsetTop - transcriptPanel.current.offsetTop;
      target?.focus({ preventScroll: true }); sourceTarget.current = null;
    }
  }, [view]);

  async function download() {
    if (exportState === "loading") return;
    setExportState("loading");
    try {
      // The production PDF renderer is loaded only when the visitor requests a PDF.
      const { downloadTranscriptPdf, loadTranscriptLogo } = await import("@/lib/download-transcript-pdf");
      const logo = await loadTranscriptLogo();
      if (!mounted.current) return;
      await downloadTranscriptPdf(buildDemoPdf(locale, scenario, logo), `shprohli-demo-${scenarioId}-${locale}.pdf`);
      if (mounted.current) setExportState("idle");
    } catch { if (mounted.current) setExportState("error"); }
  }
  const title = state.phase === "idle" ? (demoTitle ?? copy.title) : state.phase === "typing" ? copy.typing : state.phase === "compiling" ? copy.compile
    : state.phase === "review" ? copy.planTitle : state.phase === "dialing" ? copy.dialing : state.phase === "consent" ? copy.consentTitle
    : state.phase === "live" ? copy.liveTitle : state.phase === "finalizing" ? copy.finalize : copy.resultTitle;
  const showTurn = (turn: DemoTurn) => <article className={`${styles.turn} ${turn.role === "recipient" ? styles.recipientTurn : ""}`} key={turn.id}
    id={`demo-${scenarioId}-${turn.id}`} tabIndex={-1}>
    <div><strong>{turn.role === "assistant" ? copy.assistant : scenario.recipient}</strong><time>00:{String(turn.seconds).padStart(2, "0")}</time></div>
    <p>{turn.text}</p>
  </article>;

  return <>
    <header className={styles.chrome}>
      {/* Reuse the real brand symbol, not an illustration of the interface. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/icon.svg" alt="" width={23} height={23} />
      <span>{copy.label}</span><span className={styles.counter}>0{stage + 1} <span>/ 05</span></span>
    </header>
    <ol className={styles.steps} aria-label={copy.progress}>{copy.steps.map((label, index) =>
      <li key={label} aria-current={index === stage ? "step" : undefined} data-complete={index < stage}><span>{index + 1}</span>{label}</li>
    )}</ol>
    <div className={styles.body}>
      <div className={styles.statusRow}><span className={styles.eyebrow}>{copy.steps[stage]}</span>
        <span className={styles.status} data-live={state.phase === "live" && !state.paused}>{state.phase === "result" ? copy.saved : state.paused ? copy.paused : state.phase === "idle" ? copy.ready : copy.accelerated}</span>
      </div>
      <h2 className={styles.title}>{title}</h2>
      <p className={styles.announcer} role="status" aria-live="polite">{copy.step} {stage + 1}: {title}</p>

      {state.phase === "idle" || state.phase === "typing" ? <>
        <div className={styles.scenarios} role="group" aria-label={copy.choose}>{demoScenarioIds.map(id => <button key={id} type="button" aria-pressed={id === scenarioId} onClick={() => onScenario(id)}>{getDemoScenario(locale, id).label}</button>)}</div>
        <div className={styles.contact}><span className={styles.monogram} aria-hidden="true">{scenario.recipient.split(" ").map(word => word[0]).slice(0, 2).join("")}</span>
          <div><span className={styles.eyebrow}>{copy.recipient}</span><strong>{scenario.recipient}</strong><small>{copy.demoContact}</small></div>
        </div>
        <div className={styles.task}><span className={styles.eyebrow}>{copy.task}</span><p className={styles.taskText}><span className={styles.taskMeasure} aria-hidden="true">{scenario.request}</span><span className={styles.taskValue}>{state.phase === "typing" ? scenario.request.slice(0, Math.ceil(scenario.request.length * state.tick / 28)) : scenario.request}<span className={styles.cursor} aria-hidden="true" hidden={state.phase !== "typing"} /></span></p></div>
        {state.phase === "idle" ? <><button className={styles.primary} type="button" onClick={() => dispatch({ type: "start" })}>{copy.start}</button><p className={styles.helper}>{copy.introNote}</p></> : null}
      </> : null}

      {state.phase === "compiling" ? <div className={styles.processing} aria-busy="true"><div className={styles.spinner} aria-hidden="true" />
        <ol>{copy.compileSteps.map((text, index) => <li key={text} data-complete={index <= state.tick}><span>{String(index + 1).padStart(2, "0")}</span>{text}</li>)}</ol>
      </div> : null}

      {state.phase === "review" ? <>
        <p className={styles.helper}>{copy.planNote}</p>
        <div className={styles.reviewScroll} tabIndex={0} role="region" aria-label={copy.fullPlan}>
          <div className={styles.planObjective}>{scenario.plan.localizedObjective}</div>
          <h3>{copy.questions}</h3><ol>{scenario.plan.orderedQuestions.map(q => <li key={q.text}>{q.text}</li>)}</ol>
          <h3>{copy.facts}</h3><ul>{scenario.plan.approvedFacts.map(f => <li key={f.callLanguageText}>{f.callLanguageText}</li>)}</ul>
          <div className={styles.guardrails}><h3>{copy.limits}</h3><ul>{scenario.plan.prohibitedActions.map(limit => <li key={limit}>{limit}</li>)}</ul></div>
          <details><summary>{copy.fullPlan}</summary><CallPlanPresentation plan={scenario.plan} uiLocale={locale} headingLevel={4} /></details>
        </div>
        <button type="button" className={styles.primary} onClick={() => dispatch({ type: "approve" })}>{copy.approve}</button>
      </> : null}

      {state.phase === "dialing" ? <div className={styles.connecting}><span className={styles.monogram}>{scenario.recipient.split(" ").map(word => word[0]).slice(0, 2).join("")}</span><strong>{scenario.recipient}</strong><div className={styles.spinner} aria-hidden="true" /></div> : null}
      {state.phase === "consent" ? <>
        <p className={styles.helper}>{copy.consentNote}</p>
        <div className={styles.consent}><strong>{copy.assistant}</strong><p>{copy.disclosure}</p></div>
        {state.tick >= 1 ? <div className={styles.consentReply}><strong>{scenario.recipient}</strong><p>{copy.consentReply}</p></div> : null}
        {state.tick >= 2 ? <p className={styles.confirmation}>{copy.consentGranted}</p> : null}
      </> : null}

      {state.phase === "live" ? <>
        <div className={styles.liveHeader}><strong>{scenario.recipient}</strong><span>{copy.consentGranted}</span></div>
        <div className={styles.transcript} ref={transcriptPanel} role="region" aria-label={copy.live} tabIndex={0}
          onScroll={event => { const node = event.currentTarget; following.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80; }}>
          {scenario.turns.slice(0, state.tick + 1).map(showTurn)}
          <p className={styles.typingHint}>{state.paused ? copy.paused : copy.speaking}</p>
        </div>
        <p className={styles.helper}>{copy.credit}</p>
      </> : null}

      {state.phase === "finalizing" ? <div className={styles.processing} aria-busy="true"><div className={styles.spinner} aria-hidden="true" /><p>{copy.finalizeNote}</p></div> : null}
      {state.phase === "result" ? <>
        <p className={styles.helper}>{copy.resultNote}</p>
        <div className={styles.resultTabs} role="group" aria-label={copy.steps[4]}>
          <button type="button" aria-pressed={view === "transcript"} onClick={() => setView("transcript")}>{copy.transcript}</button>
          <button type="button" aria-pressed={view === "summary"} onClick={() => setView("summary")}>{copy.summary}</button>
        </div>
        <div className={styles.resultScroll} ref={transcriptPanel} role="region" aria-label={view === "transcript" ? copy.transcript : copy.summary} tabIndex={0}>
          {view === "transcript" ? scenario.turns.map(showTurn) : summaryState === "ready" ? <CallSummaryPresentation summary={scenario.summary} uiLocale={locale} headingLevel={4}
            sourceHref={id => `#demo-${scenarioId}-${id}`} onSource={id => { sourceTarget.current = `demo-${scenarioId}-${id}`; setView("transcript"); }} /> : <div className={styles.summaryEmpty}><p>{copy.summaryNote}</p><button className={styles.secondary} type="button" disabled={summaryState === "loading"} onClick={() => setSummaryState("loading")}>{summaryState === "loading" ? copy.generating : copy.generate}</button></div>}
        </div>
        <button className={styles.primary} type="button" onClick={() => void download()} disabled={exportState === "loading"}>{exportState === "loading" ? copy.exporting : copy.pdf}</button>
        {exportState === "error" ? <p role="alert" className={styles.error}>{copy.exportError}</p> : null}
        <Link className={styles.accountLink} href={registerHref}>{copy.tryOwn}</Link>
      </> : null}

      <div className={styles.controls}>
        {active ? <><button type="button" onClick={() => dispatch({ type: "pause" })} disabled={manual}>{state.paused ? copy.resume : copy.pause}</button>
          <button type="button" onClick={() => dispatch({ type: "next", turnCount: scenario.turns.length })}>{copy.next}</button></> : null}
        {state.phase !== "idle" ? <button type="button" onClick={onReplay}>{state.phase === "result" ? copy.replay : copy.reset}</button> : null}
      </div>
    </div>
    <footer className={styles.footer}>{copy.note}</footer>
  </>;
}
