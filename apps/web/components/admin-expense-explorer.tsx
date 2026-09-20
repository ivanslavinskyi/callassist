"use client";
import { formatLocale } from "@callassist/contracts";

import Image from "next/image";
import { useId, useRef, useState, type ReactNode } from "react";
import { expenseCategory, expenseGroups, formatAdminMoney, type AdminCost, type ExpenseCategory, type UsageComponent } from "@/lib/admin-costs";
import { adminExpenseMessages } from "@/lib/i18n/admin-expense-messages";
import { UiIcon } from "./ui-icon";

type Tab = "cost" | "usage" | "requests";
const tabs: Tab[] = ["cost", "usage", "requests"];
const metricSamples = {
  inputTextTokens: "inputTextTokenSamples", cachedInputTextTokens: "cachedInputTextTokenSamples",
  cacheWriteInputTextTokens: "cacheWriteInputTextTokenSamples", outputTextTokens: "outputTextTokenSamples",
  reasoningOutputTokens: "reasoningOutputTokenSamples", inputAudioTokens: "inputAudioTokenSamples",
  cachedInputAudioTokens: "cachedInputAudioTokenSamples", outputAudioTokens: "outputAudioTokenSamples",
  totalTokens: "totalTokenSamples", durationSeconds: "durationSamples", billableSeconds: "billableSamples"
} as const;

export function AdminExpenseExplorer({ cost, locale, scope = "record" }: { cost: AdminCost; locale: "en" | "de"; scope?: "record" | "period" }) {
  const copy = adminExpenseMessages[locale];
  const id = useId();
  const [selected, setSelected] = useState<ExpenseCategory | null>("realtime");
  const [tab, setTab] = useState<Tab>("cost");
  const heading = useRef<HTMLHeadingElement>(null);
  const money = (amount: number | null, precise = false, currency = "USD") => formatAdminMoney(amount, locale, precise, currency);
  const date = (at: string, time = false) => new Intl.DateTimeFormat(formatLocale(locale), { dateStyle: "medium", ...(time ? { timeStyle: "short" as const } : {}), timeZone: "UTC" }).format(new Date(at));
  const groups = expenseGroups(cost);
  const visibleGroups = groups.filter(g => g.records > 0 || g.amount !== null || (g.key === "twilio" && (cost.providerReported.recordCount > 0 || cost.providerReported.pendingOperations > 0)));
  const group = selected === null ? undefined : visibleGroups.find(g => g.key === selected) ?? visibleGroups[0];
  const billing = cost.billing.find(b => b.provider === "twilio");
  const openaiBilling = cost.billing.find(b => b.provider === "openai");
  const usage = cost.providerUsage;
  const hasIssues = usage.missingUsageOperations > 0 || usage.incompleteSessions > 0 || usage.unpricedBuckets > 0 || cost.providerReported.pendingOperations > 0;
  const close = () => { const trigger = document.getElementById(`${id}-category-${group?.key}`); setSelected(null); trigger?.focus(); };
  const records = usage.records.filter(record => expenseCategory(record.operationType) === group?.key);
  const usageDetails = (component: UsageComponent, key: string) => <dl className="expense-facts" key={key}>
    <Fact label={copy.requests}>{component.requests.toLocaleString(locale)}</Fact>
    {Object.entries(metricSamples).filter(([, sample]) => component[sample] > 0).map(([metric, sample]) => <Fact key={metric} label={copy.metric[metric as keyof typeof metricSamples]}>
      {Number(component[metric as keyof typeof metricSamples]).toLocaleString(locale)}
      {component[sample] < component.usageRecords ? <small>{copy.partial} · {component[sample]}/{component.usageRecords}</small> : null}
    </Fact>)}
  </dl>;
  return <section className="expense-explorer" aria-labelledby={`${id}-title`}>
    <header className="expense-heading">
      <div><h2 id={`${id}-title`}>{copy.title}</h2><p>{scope === "record" ? copy.lifetime : `${date(usage.from)} – ${date(new Date(Date.parse(usage.to) - 1).toISOString())}`} <span>· {copy.currency}</span></p></div>
      {scope === "period" ? <span className="expense-period-label">{copy.period}</span> : null}
    </header>
    <div className="expense-layout" data-open={!!group}>
      <div className="expense-overview">
        <div className="expense-headlines">
          <div><span>{copy.openai}</span><strong>{money(usage.calculatedUsdMicros)}</strong><small>{usage.calculatedUsdMicros === null ? copy.noActivity : usage.status === "partial" ? copy.partial : copy.calculated}</small></div>
          <div><span>{billing?.totalMicros != null ? copy.twilio : copy.twilioLocal}</span><strong>{money(billing?.totalMicros ?? cost.providerReported.usdMicros)}</strong><small>{billing?.totalMicros != null ? copy.preliminary : cost.providerReported.usdMicros === null ? copy.noActivity : cost.providerReported.pendingOperations ? copy.partial : copy.reported}</small></div>
        </div>
        <p className="expense-source-note">{copy.amountsHelp}</p>
        <div className="expense-list-heading"><span>{copy.category}</span><span>{copy.amount}</span></div>
        <div className="expense-list">
          {visibleGroups.map(item => <button key={item.key} id={`${id}-category-${item.key}`} type="button" className="expense-category" aria-expanded={group?.key === item.key} aria-controls={`${id}-details`} data-selected={group?.key === item.key}
            onClick={() => { setSelected(item.key); setTab("cost"); requestAnimationFrame(() => { heading.current?.focus({ preventScroll: true }); if (window.matchMedia("(max-width: 800px)").matches) heading.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }); }}>
            <ExpenseIcon name={item.icon} /><span className="expense-category-name">{copy.categories[item.key]}{item.incomplete > 0 ? <small>{copy.partial}</small> : null}</span>
            <strong>{money(item.amount)}</strong><ExpenseIcon name="chevron-right" />
          </button>)}
          {!visibleGroups.length ? <p className="expense-empty">{copy.empty}</p> : null}
        </div>
        {hasIssues || (scope === "period" && visibleGroups.length > 0) ? <div className="expense-coverage" data-warning={hasIssues}>
          <ExpenseIcon name={hasIssues ? "exclamation-triangle" : "information-circle"} />
          <div><strong>{hasIssues ? copy.check : copy.measured}</strong>
            {usage.missingUsageOperations > 0 ? <p>{copy.missing}: {usage.missingUsageOperations}</p> : null}
            {usage.incompleteSessions > 0 ? <p>{copy.sessions}: {usage.incompleteSessions}</p> : null}
            {usage.unpricedBuckets > 0 ? <p>{copy.incomplete}: {usage.unpricedBuckets}</p> : null}
            {cost.providerReported.pendingOperations > 0 ? <p>{copy.prices}: {cost.providerReported.pendingOperations}</p> : null}
            {scope === "period" && usage.firstRecordedAt ? <p>{copy.first}: {date(usage.firstRecordedAt)}</p> : null}
            {scope === "period" && openaiBilling?.totalMicros == null ? <p>{copy.noBilling}</p> : null}
          </div>
        </div> : null}
        {scope === "period" && cost.billing.length > 0 ? <details className="expense-reconciliation"><summary>{copy.reconciliation}</summary>
          {cost.billing.map(report => <div key={report.provider} className="expense-billing-report">
            <h3>{report.provider === "openai" ? "OpenAI" : "Twilio"}</h3>
            {report.status === "unsupported_window" ? <p>{copy.calendar}</p> : report.totalMicros === null ? <p>{report.status === "not_configured" ? copy.unavailable : copy.awaiting}</p> : <>
              <dl className="expense-facts"><Fact label={copy.account}>{money(report.totalMicros, true)}</Fact>
                <Fact label={report.provider === "twilio" ? copy.local : copy.calculated}>{money(report.provider === "twilio" ? cost.providerReported.usdMicros : usage.calculatedUsdMicros, true)}</Fact>
                <Fact label={copy.updated}>{report.observedAt ? `${date(report.observedAt, true)} UTC` : copy.unknown}</Fact>
                <Fact label={copy.missingDays}>{report.days}/{report.expectedDays}</Fact>
                <Fact label={copy.scope}>{report.scope}</Fact></dl>
              {report.status === "stale" ? <p>{copy.stale}</p> : null}
              <p>{report.provider === "twilio" ? copy.nonAdditive : copy.approximate}</p>
            </>}
          </div>)}
        </details> : null}
      </div>
      {group ? <aside className="expense-details" id={`${id}-details`} aria-labelledby={`${id}-detail-title`} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); close(); } }}>
        <div className="expense-detail-heading"><h3 id={`${id}-detail-title`} ref={heading} tabIndex={-1}>{copy.categories[group.key]}</h3><button type="button" className="expense-close" onClick={close} aria-label={copy.close}><UiIcon name="x-mark" /></button></div>
        <strong className="expense-detail-amount">{money(group.amount, true)}</strong>
        <p className="expense-detail-subtitle">{group.key === "twilio" ? billing?.totalMicros != null ? copy.billing : copy.reported : copy.calculated}{group.key !== "twilio" ? ` · ${group.requests} ${group.requests === 1 ? (locale === "de" ? "Anfrage" : "request") : locale === "de" ? copy.requests : copy.requests.toLowerCase()}` : ""}</p>
        <div className="expense-tabs" role="tablist" aria-label={copy.categories[group.key]}>
          {tabs.map((name, index) => <button key={name} type="button" role="tab" id={`${id}-${name}`} aria-controls={`${id}-tab-panel`} aria-selected={tab === name} tabIndex={tab === name ? 0 : -1} onClick={() => setTab(name)}
            onKeyDown={event => { const next = event.key === "ArrowRight" ? (index + 1) % 3 : event.key === "ArrowLeft" ? (index + 2) % 3 : event.key === "Home" ? 0 : event.key === "End" ? 2 : -1; if (next >= 0) { event.preventDefault(); setTab(tabs[next]!); document.getElementById(`${id}-${tabs[next]}`)?.focus(); } }}>{copy[name]}</button>)}
        </div>
        <div role="tabpanel" id={`${id}-tab-panel`} aria-labelledby={`${id}-${tab}`} tabIndex={0}>
          {tab === "cost" ? <>
            <dl className="expense-facts expense-price-parts">
              {group.key === "realtime" ? <><Fact label={copy.audio}>{money(usage.components.realtimeAudio.calculatedUsdMicros, true)}</Fact><Fact label={copy.text}>{money(usage.components.realtimeText.calculatedUsdMicros, true)}</Fact></> : null}
              {group.key === "transcription" ? <><Fact label={copy.realtimeTranscription}>{money(usage.components.realtimeTranscription.calculatedUsdMicros, true)}</Fact><Fact label={copy.postCallTranscription}>{money(usage.components.postCallTranscription.calculatedUsdMicros, true)}</Fact></> : null}
              {group.key === "twilio" && billing?.totalMicros != null ? billing.components.filter(part => part.amountMicros !== 0).map(part => <Fact key={part.key} label={copy.components[part.key as keyof typeof copy.components] ?? part.key}>{money(part.amountMicros, true)}</Fact>) : null}
              <Fact label={copy.total}><strong>{money(group.amount, true)}</strong></Fact>
            </dl>
            {group.key === "realtime" ? <p className="expense-detail-note">{copy.shared}</p> : null}
            {group.key === "twilio" ? <><p className="expense-detail-note">{billing?.totalMicros != null ? copy.nonAdditive : copy.pendingNote}</p><dl className="expense-facts"><Fact label={copy.local}>{money(cost.providerReported.usdMicros, true)}</Fact><Fact label={copy.prices}>{cost.providerReported.pendingOperations}</Fact>
              {cost.providerReported.amounts.filter(a => a.currency !== "USD").map(a => <Fact key={`${a.provider}:${a.component}:${a.currency}`} label={`${a.provider} · ${a.currency}`}>{money(a.amountMicros, true, a.currency)}</Fact>)}
              {billing?.observedAt ? <Fact label={copy.updated}>{date(billing.observedAt, true)} UTC</Fact> : null}</dl></> : <>
              <dl className="expense-facts"><Fact label={copy.models}>{group.models.join(", ") || copy.unknown}</Fact><Fact label={copy.version}>{usage.pricingVersions.join(", ") || usage.pricingVersion}</Fact></dl>
              <details className="expense-formula"><summary>{copy.tokens}</summary><p>{copy.formula}</p>{group.parts.map((part, index) => usageDetails(part, String(index)))}</details>
              <p className="expense-detail-note">{copy.approximate}</p>
            </>}
          </> : null}
          {tab === "usage" ? <>{group.parts.map((part, index) => <div key={index}>{group.key === "transcription" ? <h4>{index === 0 ? copy.realtimeTranscription : copy.postCallTranscription}</h4> : null}{usageDetails(part, String(index))}</div>)}</> : null}
          {tab === "requests" ? <><p className="expense-detail-note">{copy.latestRequests}</p>{records.length ? <ul className="expense-requests">{records.map(record => <li key={record.id}><div><time dateTime={record.startedAt}>{date(record.startedAt, true)} UTC</time><strong>{money(record.calculatedUsdMicros, true)}</strong></div><span>{record.model} · {record.outcome ?? copy.unknown}</span>{record.missingMetrics.length ? <small>{copy.partial}: {record.missingMetrics.join(", ")}</small> : null}<details><summary>ID</summary><code>{record.id}</code></details></li>)}</ul> : <p>{copy.noRequests}</p>}</> : null}
        </div>
      </aside> : <div id={`${id}-details`} hidden />}
    </div>
    {cost.estimatedUsdMicros !== null ? <details className="expense-manual"><summary>{copy.diagnostic}</summary><p>{copy.diagnosticHelp}</p><dl className="expense-facts"><Fact label={copy.total}>{money(cost.estimatedUsdMicros, true)}</Fact><Fact label={copy.version}>{cost.pricingVersion}</Fact></dl></details> : null}
  </section>;
}
function Fact({ label, children }: { label: string; children: ReactNode }) { return <div><dt>{label}</dt><dd>{children}</dd></div>; }
function ExpenseIcon({ name }: { name: string }) { return <Image src={`/brand/expense-icons/${name}.svg`} width={22} height={22} alt="" aria-hidden="true" />; }
