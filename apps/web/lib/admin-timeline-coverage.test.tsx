import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { AdminTimelineCoverage } from "../components/admin-call-inspector";

it.each(["en", "de"] as const)("discloses unsupported archived diagnostics in %s, including an entirely unsupported timeline", locale => {
  for (const shown of [0, 3]) {
    const html = renderToStaticMarkup(<AdminTimelineCoverage total={5} shown={shown} locale={locale} />);
    expect(html).toContain('role="status"');
    expect(html).toContain(locale === "en" ? `${shown} of 5` : `${shown} von 5`);
    expect(html).toContain(locale === "en" ? "telemetry export" : "Telemetrieexport");
  }
});

it("does not warn about complete or empty timelines or a newer timeline read", () => {
  for (const [total, shown] of [[0, 0], [3, 3], [3, 4]]) {
    expect(renderToStaticMarkup(<AdminTimelineCoverage total={total!} shown={shown!} locale="en" />)).toBe("");
  }
});
