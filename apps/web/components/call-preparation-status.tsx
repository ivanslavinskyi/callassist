"use client";

import type { CallPreparationProgress } from "@/lib/api";
import { useUiLocale } from "./ui-locale-provider";

export function CallPreparationStatus({ progress }: { progress: CallPreparationProgress }) {
  const { messages } = useUiLocale();
  const copy = messages.form;
  const description = {
    queued: copy.preparingQueuedText,
    preparing: copy.preparingText,
    retrying: copy.preparingRetryingText,
    delayed: copy.preparingDelayedText
  }[progress];

  return (
    <div className="compilation-progress" role="status" aria-live="polite" aria-atomic="true">
      <span className="processing-spinner" aria-hidden="true" />
      <div>
        <strong>{copy.preparingTitle}</strong>
        <p>{description}</p>
      </div>
    </div>
  );
}
