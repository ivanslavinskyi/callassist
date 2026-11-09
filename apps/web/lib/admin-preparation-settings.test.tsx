import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { defaultPreparationCapacity, defaultPreparationRuntimePolicy, type PreparationSettingsView } from "@callassist/contracts";
import { PreparationSettingsForm, RuntimeProfileStatus } from "../components/admin-preparation-settings";
import { runtimeProfileMessages } from "./i18n/admin-runtime-profile-messages";
import { preparationSettingsMessages } from "./i18n/preparation-settings-messages";

const view:PreparationSettingsView={policy:defaultPreparationRuntimePolicy,capacity:defaultPreparationCapacity,approvedProfiles:["gpt-5.6:default"],updatedAt:null,updatedByUserId:null,reason:null,history:[]};
it.each(["en","de","ru","uk","fr","it","rm"] as const)("shows saved and required runtime policy without editable controls in %s", locale => {
  const profile: NonNullable<PreparationSettingsView["runtimeProfile"]> = { name: "native_v2", release: "native-v2-2026-11-09",
    mode: "live_native_v2", runtimeVersion: "live-native-context-2026-11-09", compilerVersion: "brief-compiler-14", planSchemaVersion: "9",
    expectedPromptVersion: "preparation-live-native-roles-2026-11-09", actualPromptVersion: "preparation-2026-10-05", ready: false };
  const html = renderToStaticMarkup(<RuntimeProfileStatus profile={profile} locale={locale} />);
  expect(html).toContain(runtimeProfileMessages[locale].mismatch);
  expect(html).toContain(profile.expectedPromptVersion); expect(html).toContain(profile.actualPromptVersion);
  expect(html).not.toContain("<input"); expect(html).not.toContain("<select");
  expect(renderToStaticMarkup(<RuntimeProfileStatus profile={{ ...profile, ready: true, actualPromptVersion: profile.expectedPromptVersion }} locale={locale} />))
    .toContain(runtimeProfileMessages[locale].ready);
});
it.each(["admin","superadmin"] as const)("renders role protection and the saved preparation profile for %s",role=>{
  const html=renderToStaticMarkup(<PreparationSettingsForm view={view} copy={preparationSettingsMessages.en} role={role} busy={false} onSubmit={()=>{}} />);
  expect(html.includes('<fieldset disabled=""')).toBe(role!=="superadmin");
  expect(html).toContain('value="gpt-5.6" selected=""');
  expect(html).toContain('name="fast"');expect(html).toContain('name="voiceReservePercent"');
  expect(html).toContain('name="reason"');expect(html).not.toContain('name="audit"');
});
it.each(["en","de","ru","uk","fr","it","rm"] as const)("allows every profile with an optional comment in %s",locale=>{
  for(const model of ["gpt-5.6","gpt-5.6-terra","gpt-6-luna"] as const) {
    const selected={...view,policy:{...view.policy,generation:{model,serviceTier:"fast" as const}}};
    const html=renderToStaticMarkup(<PreparationSettingsForm view={selected} copy={preparationSettingsMessages[locale]} role="superadmin" busy={false} onSubmit={()=>{}} />);
    expect(html).not.toContain('type="submit" disabled=""');
    expect(html).toContain('name="reason" maxLength="500"');
    expect(html).not.toContain('name="report"');
  }
});
it("disables controls while saving",()=>{
  const html=renderToStaticMarkup(<PreparationSettingsForm view={view} copy={preparationSettingsMessages.en} role="superadmin" busy onSubmit={()=>{}} />);
  expect(html).toContain('<fieldset disabled=""');
});
