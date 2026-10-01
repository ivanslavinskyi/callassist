import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CallSnapshot } from "@callassist/contracts";
import { CallTranscriptResult } from "./call-transcript-result";
vi.mock("./ui-locale-provider",()=>({useUiLocale:()=>({locale:"ru"})}));
vi.mock("./call-result-panel",()=>({CallResultPanel:({revision,allowSummaryGeneration}:any)=>React.createElement('p',{'data-summary-generation':String(allowSummaryGeneration)},revision.text)}));
const base={brief:{locale:"de-CH"},recording:{status:"available",deleteAfter:"2099-01-01T00:00:00.000Z"},
  finalTranscript:{status:"completed",source:"live_composed",text:"Live words",quality:{coverage:"partial",issues:[]}},
  finalTranscriptRevision:{id:"live",text:"Live words"}} as unknown as CallSnapshot;
describe("transcript source tabs",()=>{
 it("renders Live and its partial warning; the audio tab renders a button without requesting anything",()=>{
  const request=vi.fn();
  const render=(view:'live'|'recording',snapshot=base)=>renderToStaticMarkup(React.createElement(CallTranscriptResult,{snapshot,userId:'owner',view,busy:false,onRequest:request,onViewRecording:vi.fn()}));
  expect(render('live')).toContain('Live words');expect(render('live')).toContain('Часть реплик');
  expect(render('recording')).toContain('Расшифровать аудиозапись');expect(request).not.toHaveBeenCalled();
  expect(render('recording',{...base,recording:{...base.recording!,status:'deleted'}})).not.toContain('<button');
 });
 it("uses the audio revision and disallows generating another summary in that tab",()=>{
  const snapshot={...base,recordingTranscript:{status:'completed',source:'recording_asr',text:'Audio words'},recordingTranscriptRevision:{id:'asr',text:'Audio words'}} as CallSnapshot;
  const html=renderToStaticMarkup(React.createElement(CallTranscriptResult,{snapshot,userId:'owner',view:'recording',busy:false,onRequest:vi.fn(),onViewRecording:vi.fn()}));
  expect(html).toContain('Audio words');expect(html).not.toContain('Live words');expect(html).toContain('data-summary-generation="false"');
 });
});
