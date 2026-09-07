"use client";

import type { AdminOperationsOverview } from "@callassist/contracts";
import { adminCallMessages } from "@/lib/i18n/admin-call-messages";

export function AdminCostBreakdown({
  cost,
  locale
}: {
  cost: AdminOperationsOverview["cost"];
  locale: "en" | "de";
}) {
  const copy = adminCallMessages[locale];
  return (
    <section className="admin-inspector-summary">
      <h2>{copy.costTitle}</h2>
      <p>{copy.costHelp}</p>
      <dl>
        <Fact
          label={copy.configuredEstimate}
          value={formatMoney(cost.estimatedUsdMicros, "USD", locale, copy.notAvailable)}
        />
        <Fact
          label={copy.calculatedUsageCost}
          value={formatMoney(
            cost.providerUsage.calculatedUsdMicros,
            "USD",
            locale,
            copy.notAvailable
          )}
        />
        <Fact
          label={copy.providerReportedCost}
          value={formatMoney(
            cost.providerReported.usdMicros,
            "USD",
            locale,
            copy.notAvailable
          )}
        />
        <Fact
          label={copy.providerOperations}
          value={String(cost.providerUsage.operationCount)}
        />
        <Fact
          label={copy.providerUsageRecords}
          value={String(cost.providerUsage.usageRecordCount)}
        />
      </dl>
      <div className="admin-inspector-grid">
        {Object.entries(cost.providerUsage.components)
          .filter(([, component]) => component.usageRecords > 0)
          .map(([key, component]) => (
            <article className="admin-inspector-panel" key={key}>
              <h3>{copy.costComponents[key as keyof typeof copy.costComponents]}</h3>
              <dl>
                <Fact label={copy.requests} value={String(component.requests)} />
                <Fact
                  label={copy.textTokens}
                  value={formatMeasuredSequence([
                    [component.inputTextTokens, component.inputTextTokenSamples],
                    [component.cachedInputTextTokens, component.cachedInputTextTokenSamples],
                    [component.cacheWriteInputTextTokens, component.cacheWriteInputTextTokenSamples],
                    [component.outputTextTokens, component.outputTextTokenSamples]
                  ], locale)}
                />
                <Fact
                  label={copy.audioTokens}
                  value={formatMeasuredSequence([
                    [component.inputAudioTokens, component.inputAudioTokenSamples],
                    [component.cachedInputAudioTokens, component.cachedInputAudioTokenSamples],
                    [component.outputAudioTokens, component.outputAudioTokenSamples]
                  ], locale)}
                />
                <Fact
                  label={copy.providerUsageDuration}
                  value={component.durationSamples === 0
                    ? copy.notAvailable
                    : formatDuration(Math.round(component.durationSeconds))}
                />
                <Fact
                  label={copy.calculatedUsageCost}
                  value={formatMoney(
                    component.calculatedUsdMicros,
                    "USD",
                    locale,
                    copy.notAvailable
                  )}
                />
              </dl>
            </article>
          ))}
        {cost.providerReported.amounts.map((amount) => (
          <article
            className="admin-inspector-panel"
            key={`${amount.provider}:${amount.component}:${amount.currency}`}
          >
            <h3>{amount.provider} · {copy.providerActual}</h3>
            <dl>
              <Fact label={copy.providerUsageRecords} value={String(amount.records)} />
              <Fact
                label={amount.currency}
                value={formatMoney(
                  amount.amountMicros,
                  amount.currency,
                  locale,
                  copy.notAvailable
                )}
              />
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function formatDuration(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatMeasuredSequence(
  values: Array<readonly [value: number, samples: number]>,
  locale: "en" | "de"
) {
  const formatter = new Intl.NumberFormat(locale === "de" ? "de-CH" : "en-GB");
  return values
    .map(([value, samples]) => samples === 0 ? "—" : formatter.format(value))
    .join(" / ");
}

function formatMoney(
  micros: number | null,
  currency: string,
  locale: "en" | "de",
  fallback: string
) {
  if (micros === null) return fallback;
  return new Intl.NumberFormat(locale === "de" ? "de-CH" : "en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: 4,
    maximumFractionDigits: 6
  }).format(micros / 1_000_000);
}
