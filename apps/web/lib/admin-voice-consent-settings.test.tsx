import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { defaultVoiceConsentRuntimePolicy, voiceConsentRuntimePolicy, type VoiceConsentSettingsView } from "@callassist/contracts";
import { VoiceConsentSettingsForm } from "../components/admin-voice-consent-settings";
import { voiceConsentMessages } from "./i18n/voice-consent-messages";

const view: VoiceConsentSettingsView = { policy: defaultVoiceConsentRuntimePolicy, updatedAt: null, updatedByUserId: null, reason: null };
it.each(["admin", "superadmin"] as const)("renders a protected consent form for %s", role => {
  const html = renderToStaticMarkup(<VoiceConsentSettingsForm role={role} view={view} copy={voiceConsentMessages.en} busy={false} onSubmit={() => {}} />);
  expect(html.includes('<fieldset disabled=""')).toBe(role !== "superadmin");
  expect(html).toContain('value="semantic_native" selected=""');
  expect(html).toContain('name="reason"');
  expect(html).toContain('minLength="3"');
  expect(html).not.toContain('name="fastSettleMs"');
});
it("renders the actual hybrid selection and blocks a pending save", () => {
  const html = renderToStaticMarkup(<VoiceConsentSettingsForm role="superadmin" view={{ ...view, policy: voiceConsentRuntimePolicy("hybrid_deterministic_v1", 2) }}
    copy={voiceConsentMessages.ru} busy={true} onSubmit={() => {}} />);
  expect(html).toContain('value="hybrid_deterministic_v1" selected=""');
  expect(html).toContain('<fieldset disabled=""');
  expect(html).toContain(voiceConsentMessages.ru.saving);
});
