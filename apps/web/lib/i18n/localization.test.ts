import { transcriptExportCopy } from "../final-transcript-export";
import { getDemoScenario, demoScenarioIds } from "../interactive-demo";
import { describe, expect, it } from "vitest";
import { additionalUiResources, translatePhrase } from "./extend-messages";
import { uiLocales, uiLocaleRegistry } from "@callassist/contracts";
import * as m0 from "./account-messages";
import * as m1 from "./appointment-messages";
import * as m2 from "./auth-messages";
import * as m3 from "./beta-messages";
import * as m4 from "./call-activity-messages";
import * as m5 from "./call-presentation";
import * as m6 from "./demo-messages";
import * as m7 from "./design-messages";
import * as m8 from "./email-verification-messages";
import * as m9 from "./landing-messages";
import * as m10 from "./language-messages";
import * as m11 from "./messages";
import * as m12 from "./onboarding-messages";
import * as m13 from "./opt-out-messages";
import * as m14 from "./text-artifact-messages";
import * as m15 from "./system-messages";
import * as m16 from "./lifecycle-messages";
import * as m17 from "./registration-call-messages";
const namespaces = [m0,m1,m2,m3,m4,m5,m6,m7,m8,m9,m10,m11,m12,m13,m14,m15,m16,m17];
const identities = new Set(["SHPROHLI", "Europe/Zurich", "Ivan Slavinskyi", "Anna Keller", "Chrome", "Microsoft Edge", "Firefox", "Safari", "Windows", "macOS", "iOS", "Android", "Linux"]);
function strings(value: unknown): string[] {
 if (typeof value === "string") return value && !/^[a-z0-9_:+.\/{}-]+$/.test(value) && !identities.has(value) && !value.endsWith(" \u2014 SHPROHLI") ? [value] : [];
 if (typeof value === "function") return [[1,9],[2,10],["{0}","{1}"],[true],[false]].flatMap(args => { try { return strings(value(...args)); } catch { return []; } });
 if (value && typeof value === "object") return Object.values(value).flatMap(strings);
 return [];
}
describe("customer locale coverage", () => {
 it("keeps all registration and call-action keys in every UI locale", () => {
  for (const locale of uiLocales) expect(Object.keys(m17.registrationCallMessages[locale]).sort())
    .toEqual(Object.keys(m17.registrationCallMessages.en).sort());
 });
 it("matches complete interpolation templates before shorter suffixes", () => {
  expect(translatePhrase("2 call credits", "fr")).toBe(additionalUiResources.fr!["{0} call credits"]!.replace("{0}", "2"));
  expect(translatePhrase("2 credits were granted to Nina.", "uk")).toBe(additionalUiResources.uk!["{0} credits were granted to {1}."]!.replace("{0}", "2").replace("{1}", "Nina"));
 });
 it("requires a catalogue before enabling any additional locale", () => {
  for (const locale of uiLocales) if (locale !== "en" && locale !== "de") expect(additionalUiResources[locale]).toBeDefined();
 });
 it("lists all enabled UI languages in native-name order", () => {
  expect(uiLocales.map(locale => uiLocaleRegistry[locale].shortCode)).toEqual(["DE","FR","IT","RM","EN","RU","UK"]);
 });
 for (const locale of Object.keys(additionalUiResources) as Array<keyof typeof additionalUiResources>) {
  it(`provides complete customer namespaces for ${locale}`, () => {
   const sources = [...strings(transcriptExportCopy.en), ...demoScenarioIds.flatMap(id => strings(getDemoScenario("en", id))), ...namespaces.flatMap(module => Object.values(module).flatMap(value => value && typeof value === "object" && "en" in value ? strings(value.en) : []))];
   const missing = [...new Set(sources.filter(source => !Object.hasOwn(additionalUiResources[locale]!, source) && translatePhrase(source, locale) === source))];
   expect(missing).toEqual([]);
  });
 }
});
