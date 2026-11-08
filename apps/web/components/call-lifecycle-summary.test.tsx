import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {it,expect} from "vitest";
import {deriveCallLifecycle,uiLocales,type CallLifecycle} from "@callassist/contracts";
import {CallLifecycleSummary} from "./call-lifecycle-summary";
import {answeringMessages} from "@/lib/i18n/answering-messages";
import {lifecycleMessages} from "@/lib/i18n/lifecycle-messages";

it.each(uiLocales)("shows the native automated result and message status in %s",locale=>{
  const lifecycle:CallLifecycle={...deriveCallLifecycle("completed",[]),result:"automated_answer",recordingBasis:"declarative_local",
    consent:"not_requested",credit:"returned",conversationStartedAt:"2026-11-07T11:29:40.543Z",
    answering:{phase:"resolved",policyVersion:"twilio-async-live-inconclusive-v3",execution:"async",actionDispatched:true,
      mode:"Enable",answeredBy:"machine_start",decision:"hang_up",streamAdmitted:true,observedAt:"2026-11-07T11:29:43.048Z",
      durationMs:2977,message:"not_requested",failure:null}};
  const html=renderToStaticMarkup(<CallLifecycleSummary lifecycle={lifecycle} locale={locale}/>);
  const escaped=(text:string)=>renderToStaticMarkup(<>{text}</>);
  expect(html).toContain(escaped(answeringMessages[locale].results.automated_answer[0]));
  expect(html).toContain(escaped(answeringMessages[locale].message.not_requested));
  expect(html).toContain(escaped(lifecycleMessages[locale].creditReturned));
  expect(html).not.toContain(`<span>${escaped(lifecycleMessages[locale].conversation)}</span>`);
});
