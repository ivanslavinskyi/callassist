import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { uiLocales, type UiLocale, type CallBrief, type CallTextArtifact, type FinalTranscriptRevision } from "@callassist/contracts";
import { CallResultPanel } from "./call-result-panel";
import { textArtifactMessages } from "@/lib/i18n/text-artifact-messages";

vi.mock("./ui-locale-provider", () => ({ useUiLocale: () => ({ locale: state.locale, messages: { live: { aiWarning: "" } } }) }));
vi.mock("./call-draft-provider", () => ({ useCallDraftStore: () => ({ getView: () => "original" }) }));
const state = vi.hoisted(() => ({ locale: "ru" as UiLocale, pollingPaused: false, availabilityStatus: "loading" }));
vi.mock("./use-call-text-artifacts", () => ({ useCallTextArtifacts: (_id: string, items: CallTextArtifact[]) => ({ items, pollingPaused: state.pollingPaused }) }));
vi.mock("./use-text-capabilities", () => ({ useTextCapabilities: () => ({ availabilityStatus: state.availabilityStatus }), canGenerateText: () => true }));
const revision = { id: "revision", sourceHash: "source", text: "Call transcript", segments: [], revision: 1 } as unknown as FinalTranscriptRevision;
const brief = { id: "call", locale: "ru-RU", status: "completed" } as CallBrief;
function render(status: CallTextArtifact["status"]) {
  const artifact = { id: "summary", callId: brief.id, kind: "call_summary", status, transcriptRevisionId: revision.id,
    sourceHash: revision.sourceHash, targetLanguage: "ru", createdAt: "2026-11-10T09:48:00Z", payload: null } as CallTextArtifact;
  return renderToStaticMarkup(<CallResultPanel brief={brief} userId="owner" revision={revision} taskLanguage="ru"
    promptLanguage="ru" initialArtifacts={[artifact]} />);
}
it.each(["de-CH", "de-DE"] as const)("displays the canonical name in a saved %s opening without rewriting its source", locale => {
  const source: FinalTranscriptRevision = { ...revision, text: "Grüezi, ich bin Schprochli.", segments: [
    { id: "opening", role: "assistant", text: "Grüezi, ich bin Schprochli.", startSeconds: 0, endSeconds: 2 }
  ] };
  const original = structuredClone(source);
  const html = renderToStaticMarkup(<CallResultPanel brief={{ ...brief, locale }} userId="owner" revision={source}
    taskLanguage="de" promptLanguage="de" initialArtifacts={[]} showSummary={false} />);
  expect(html).toContain("Grüezi, ich bin Shprohli.");
  expect(html).not.toContain("Schprochli");
  expect(source).toEqual(original);
});
it.each(uiLocales.flatMap(locale => (["queued", "processing"] as const).map(status => ({ locale, status }))))("shows localized $status progress in the result panel in $locale while capabilities load", ({ locale, status }) => {
  state.locale = locale; state.pollingPaused = false; state.availabilityStatus = "loading";
  const html = render(status);
  expect(html).toContain('role="progressbar"');
  expect(html).toContain(renderToStaticMarkup(<span>{textArtifactMessages[locale].summaryLoading.replace(/…$/, "")}</span>).slice(6,-7));
  expect(html).not.toContain(renderToStaticMarkup(<span>{textArtifactMessages[locale].checkingAvailability}</span>).slice(6,-7));
});
it.each(uiLocales)("does not animate failed or paused analysis in %s", locale => {
  state.locale = locale; state.availabilityStatus = "ready"; state.pollingPaused = false;
  expect(render("failed")).not.toContain('role="progressbar"');
  state.pollingPaused = true;
  expect(render("processing")).not.toContain('role="progressbar"');
  expect(render("processing")).toContain(renderToStaticMarkup(<span>{textArtifactMessages[locale].pending}</span>).slice(6,-7));
  state.pollingPaused = false;
});
