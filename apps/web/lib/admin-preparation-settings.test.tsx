import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { defaultPreparationCapacity, defaultPreparationRuntimePolicy, type PreparationSettingsView } from "@callassist/contracts";
import { PreparationSettingsForm } from "../components/admin-preparation-settings";
import { preparationSettingsMessages } from "./i18n/preparation-settings-messages";

const view:PreparationSettingsView={policy:defaultPreparationRuntimePolicy,capacity:defaultPreparationCapacity,approvedProfiles:["gpt-5.6:default"],updatedAt:null,updatedByUserId:null,reason:null,history:[]};
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
