import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { createUiLocaleRouting, uiLocaleRegistry } from "./registry";
import { SELECTABLE_CALL_LANGUAGES, TEXT_LANGUAGES } from "@callassist/contracts";

describe("extensible interface locale registry", () => {
  it("routes and renders a test third locale without changing call or text capabilities", () => {
    const voiceBefore = structuredClone(SELECTABLE_CALL_LANGUAGES);
    const textBefore = [...TEXT_LANGUAGES];
    const registry = { ...uiLocaleRegistry, pl: { nativeName: "Polski", formatLocale: "pl-PL", direction: "ltr" as const } };
    const routing = createUiLocaleRouting(registry, "en");
    expect(routing.fromPathname("/pl/app/calls/example")).toBe("pl");
    expect(routing.localizePathname("/de/app/calls/example", "pl")).toBe("/pl/app/calls/example");
    expect(routing.negotiate({ acceptLanguage: "de;q=0,pl-PL;q=.9,en;q=.8" })).toBe("pl");
    expect(renderToStaticMarkup(createElement("main", { lang: "pl", dir: registry.pl.direction }, "Przykład"))).toContain('lang="pl"');
    expect(SELECTABLE_CALL_LANGUAGES).toEqual(voiceBefore);
    expect(TEXT_LANGUAGES).toEqual(textBefore);
  });
});
