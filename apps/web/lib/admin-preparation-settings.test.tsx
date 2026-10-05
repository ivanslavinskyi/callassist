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
it("prevents saving an unapproved profile and protects a pending save",()=>{
  const unapproved={...view,policy:{...view.policy,generation:{model:"gpt-6-luna" as const,serviceTier:"fast" as const}}};
  const html=renderToStaticMarkup(<PreparationSettingsForm view={unapproved} copy={preparationSettingsMessages.ru} role="superadmin" busy onSubmit={()=>{}} />);
  expect(html).toContain('type="submit" disabled=""');expect(html).toContain('<fieldset disabled=""');
  expect(html).toContain(preparationSettingsMessages.ru.pending);
});
