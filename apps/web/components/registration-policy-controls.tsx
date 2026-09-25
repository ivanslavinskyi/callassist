"use client";
import { useEffect, useState, type FormEvent } from "react";
import type { BetaControlsView, RegistrationPolicy, UserRole } from "@callassist/contracts";
import { getBetaControls, updateRegistrationPolicy } from "@/lib/api";
import { registrationCallMessages } from "@/lib/i18n/registration-call-messages";
import { useUiLocale } from "./ui-locale-provider";

export function RegistrationPolicyControls({ role }: { role: UserRole }) {
  const { locale } = useUiLocale();
  const copy = registrationCallMessages[locale];
  const [view, setView] = useState<BetaControlsView | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  async function load() {
    setBusy(true);
    try { setView(await getBetaControls()); setStatus("idle"); }
    catch { setStatus("error"); setView(null); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, []);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!view || busy || role !== "superadmin") return;
    const data = new FormData(event.currentTarget);
    const policy = { onboarding: data.get("onboarding"), emailVerification: data.get("emailVerification") } as RegistrationPolicy;
    setBusy(true); setStatus("idle");
    try {
      await updateRegistrationPolicy(policy, view.revision, String(data.get("reason")));
      setView(await getBetaControls()); setStatus("saved");
    } catch { setStatus("error"); setView(null); }
    finally { setBusy(false); }
  }
  return <section className="admin-system-panel" aria-busy={busy}>
    <h3>{copy.policyTitle}</h3>
    {view ? <form key={view.revision} onSubmit={save}><fieldset disabled={busy || role !== "superadmin"}>
      <label className="field"><span>{copy.onboarding}</span><select name="onboarding" defaultValue={view.settings.registration.onboarding}>
        <option value="full">{copy.full}</option><option value="registration">{copy.simplified}</option>
      </select></label>
      <label className="field"><span>{copy.emailPolicy}</span><select name="emailVerification" defaultValue={view.settings.registration.emailVerification}>
        <option value="required">{copy.required}</option><option value="deferrable">{copy.deferrable}</option>
      </select></label>
      <label className="field"><span>{copy.reason}</span><input name="reason" required minLength={3} maxLength={500} /></label>
      <button type="submit" className="primary-button">{copy.savePolicy}</button>
    </fieldset></form> : <button type="button" disabled={busy} onClick={() => void load()}>{copy.reload}</button>}
    {status !== "idle" ? <p role={status === "error" ? "alert" : "status"}>{status === "error" ? copy.policyError : copy.savedPolicy}</p> : null}
  </section>;
}
