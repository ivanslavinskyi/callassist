"use client";
import { useEffect, useState } from "react";
import { answeringApproval, type CallSnapshot, type UiLocale } from "@callassist/contracts";
import { getCallSnapshot } from "@/lib/api";
import { CallLifecycleSummary } from "./call-lifecycle-summary";

export function PreviousCallResult({ callId, locale }: { callId: string; locale: UiLocale }) {
  const [source, setSource] = useState<CallSnapshot | null>(null);
  useEffect(() => {
    let active = true;
    void getCallSnapshot(callId).then(value => { if (active) setSource(value); }).catch(() => { if (active) setSource(null); });
    return () => { active = false; };
  }, [callId]);
  if (!source?.brief.lifecycle?.answering) return null;
  const plan = source.compilation?.compiledBrief;
  return <CallLifecycleSummary locale={locale} lifecycle={source.brief.lifecycle}
    message={plan ? answeringApproval(plan.voicemailAction, plan.callLocale).message : null} />;
}
