"use client";

import type { CallPreparationProgress } from "@/lib/api";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useUiLocale } from "./ui-locale-provider";
import styles from "./workflow-feedback.module.css";

export function CallPreparationStatus({ progress }: { progress: CallPreparationProgress }) {
  const { messages } = useUiLocale();
  const copy = messages.form;
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const description = {
    queued: copy.preparingQueuedText,
    preparing: copy.preparingText,
    retrying: copy.preparingRetryingText,
    delayed: copy.preparingDelayedText
  }[progress];

  return <>
    <div className={styles.preparationSpace} aria-hidden="true" />
    {mounted ? createPortal(
      <div className={styles.preparationPanel}
        role="status" aria-live="polite" aria-atomic="true" data-progress={progress}>
        <div className={styles.preparationHeading}>
          <span className={styles.spinner} aria-hidden="true" />
          <strong>{copy.preparingTitle}</strong>
        </div>
        <p>{description}</p>
        <div className={styles.progressTrack} aria-hidden="true"><span /></div>
        <small>{copy.preparingReviewReminder}</small>
      </div>, document.body
    ) : null}
  </>;
}
