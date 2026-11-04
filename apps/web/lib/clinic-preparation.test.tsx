import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { uiLocales, type CreateCallBriefInput } from "@callassist/contracts";
import { CreateCallForm } from "../components/create-call-form";
import { CallDraftProvider } from "../components/call-draft-provider";
import { UiLocaleProvider } from "../components/ui-locale-provider";
import { clinicPreparationMessages } from "./i18n/clinic-preparation-messages";

afterEach(() => vi.unstubAllGlobals());

const input: CreateCallBriefInput = {
  recipientName: "Test Clinic", phoneNumber: "+41525550123",
  representedPersonFirstName: "QA", representedPersonLastName: "Tester",
  objective: "Book a check-up tomorrow between 09:00 and 12:00",
  locale: "de-CH", assistantProfileId: "sebastian", allowedFacts: []
};

describe("optional clinic preparation", () => {
  it.each(uiLocales)("offers localized guidance without adding facts or blocking preparation (%s)", locale => {
    vi.stubGlobal("React", React);
    const copy = clinicPreparationMessages[locale];
    for (const objective of [input.objective, "Ask whether the submitted form was received"]) {
      for (const allowedFacts of [
        [],
        ["Date of birth: 1990-04-12", "QA Tester has visited this clinic before."],
        ["QA Tester has never visited this clinic."],
        ["Date of birth: unknown", "Previous visit: unknown"],
        ["Do not share the date of birth.", "Do not share previous visit history."]
      ]) {
        const initialValue = { ...input, objective, allowedFacts };
        const before = structuredClone(initialValue);
        const html = renderToStaticMarkup(
          <UiLocaleProvider locale={locale} contentOnly>
            <CallDraftProvider><CreateCallForm initialValue={initialValue} onCreated={() => {}} /></CallDraftProvider>
          </UiLocaleProvider>
        );
        const guidance = html.match(/<details><summary>[\s\S]*?<\/details>/)?.[0];
        expect(guidance).toBeDefined();
        for (const text of Object.values(copy)) {
          expect(guidance).toContain(renderToStaticMarkup(<>{text}</>));
        }
        expect(guidance).not.toMatch(/<(input|select|textarea|button)\b/);
        // This is the actual editable facts field, not a hidden default or a placeholder.
        const facts = [...html.matchAll(/<textarea\b[^>]*>([\s\S]*?)<\/textarea>/g)].at(-1)?.[1];
        expect(facts).toBe(allowedFacts.join("\n"));
        const submit = html.match(/<button\b[^>]*type="submit"[^>]*>/)?.[0];
        expect(submit).toBeDefined();
        expect(submit).not.toContain("disabled");
        expect(initialValue).toEqual(before);
      }
    }
  });
});
