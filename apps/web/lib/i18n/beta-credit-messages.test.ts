import { describe, expect, it } from "vitest";
import { uiLocales } from "@callassist/contracts";
import { betaAllowanceText, betaCreditMessages, betaPlacesText } from "./beta-credit-messages";
describe("beta credit and availability copy", () => {
  it.each(uiLocales)("has explicit complete policy and capacity copy for %s", locale => {
    expect(Object.keys(betaCreditMessages[locale]).sort()).toEqual(Object.keys(betaCreditMessages.en).sort());
    for (const period of ["lifetime", "day", "week", "month"] as const) expect(betaAllowanceText({ amount: 5, period }, locale)).toContain("5");
    for (const count of [0, 1, 2, 5, 21]) expect(betaPlacesText(count, locale)).not.toContain("{n}");
    if (locale !== "en") expect(betaCreditMessages[locale].noCarry).not.toBe(betaCreditMessages.en.noCarry);
  });
  it("uses the Russian and Ukrainian plural categories for places", () => {
    expect(betaPlacesText(1,"ru")).toContain("1 место"); expect(betaPlacesText(2,"ru")).toContain("2 места"); expect(betaPlacesText(5,"ru")).toContain("5 мест");
    expect(betaPlacesText(21,"uk")).toContain("21 місце"); expect(betaPlacesText(2,"uk")).toContain("2 місця");
  });
});
