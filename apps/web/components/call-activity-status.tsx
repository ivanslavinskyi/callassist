"use client";

import type { CallActivityPhase } from "@/lib/call-activity";
import { callActivityMessages } from "@/lib/i18n/call-activity-messages";
import { useUiLocale } from "./ui-locale-provider";
import styles from "./workflow-feedback.module.css";

export function CallActivityStatus({ phase, recipientName, compact = false }: {
  phase: CallActivityPhase;
  recipientName: string;
  compact?: boolean;
}) {
  const { locale } = useUiLocale();
  const copy = callActivityMessages[locale][phase];
  const initials = recipientName.trim().split(/\s+/).slice(0, 2).map((word) => [...word][0]).join("").toLocaleUpperCase(locale);
  return <div className={`${styles.callActivity} ${compact ? styles.compact : ""}`} data-phase={phase}
    role="status" aria-live="polite" aria-atomic="true">
    <div className={styles.callOrbit} aria-hidden="true">
      <span className={styles.orbitRing} /><span className={styles.orbitRing} />
      <span className={styles.recipientAvatar}>{initials}</span>
    </div>
    <div className={styles.activityCopy}>
      <span className={styles.activityLabel}><span aria-hidden="true" />{copy.label}</span>
      <h3>{copy.title(recipientName)}</h3>
      {!compact ? <p>{copy.help}</p> : null}
    </div>
  </div>;
}
