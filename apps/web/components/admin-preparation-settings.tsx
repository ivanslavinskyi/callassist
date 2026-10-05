"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { formatDateTime, preparationModelSchema, preparationSettingsUpdateSchema,
  type PreparationSettingsView, type UserRole } from "@callassist/contracts";
import { getPreparationSettings, updatePreparationSettings } from "@/lib/api";
import { preparationSettingsMessages } from "@/lib/i18n/preparation-settings-messages";
import { useUiLocale } from "./ui-locale-provider";

export function AdminPreparationSettings({ role }: { role: UserRole }) {
  const { locale } = useUiLocale(), copy = preparationSettingsMessages[locale];
  const [view, setView] = useState<PreparationSettingsView | null>(null), [busy, setBusy] = useState(true);
  const [error, setError] = useState(false), [saved, setSaved] = useState(false);
  const version = useRef(0);
  const load = useCallback(async () => {
    const request = ++version.current; setBusy(true); setError(false); setSaved(false);
    try { const next = await getPreparationSettings(); if (request === version.current) setView(next); }
    catch { if (request === version.current) { setView(null); setError(true); } }
    finally { if (request === version.current) setBusy(false); }
  }, []);
  useEffect(() => { const requestVersion=version; void load(); return () => { requestVersion.current++; }; }, [load]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!view || busy || role !== "superadmin") return;
    const data = new FormData(event.currentTarget);
    const profile = { model: data.get("model"), serviceTier: data.get("fast") ? "fast" : "default" };
    const parsed = preparationSettingsUpdateSchema.safeParse({ generation: profile, expectedRevision: view.policy.revision, reason: data.get("reason") ?? "",
        capacity: Object.fromEntries(Object.keys(view.capacity).map(key => [key, Number(data.get(key))])) });
    if (!parsed.success) { setError(true); return; }
    const request = ++version.current; setBusy(true); setError(false); setSaved(false);
    try {
      const next = await updatePreparationSettings(parsed.data);
      if (request === version.current) { setView(next); setSaved(true); }
    } catch { if (request === version.current) { setView(null); setError(true); } }
    finally { if (request === version.current) setBusy(false); }
  }
  return <section className="admin-system-panel" id="preparation-settings" aria-busy={busy}>
    <h2>{copy.title}</h2><p>{copy.scope}</p><p>{copy.fastHelp}</p>
    <button type="button" className="secondary-button" disabled={busy} onClick={() => void load()}>{copy.refresh}</button>
    {error && <p role="alert" className="form-error">{copy.error}</p>}{saved && <p role="status">{copy.saved}</p>}
    {view && <>
      <p>{copy.revision}: {view.policy.revision}</p>
      <PreparationSettingsForm key={view.policy.revision} view={view} copy={copy} busy={busy} role={role} onSubmit={e=>void submit(e)} />
      <details><summary>{copy.history}</summary><ul>{view.history.map(item => <li key={item.revision}>
        {formatDateTime(item.createdAt, locale)} · {item.generation.model} · {item.generation.serviceTier} · {item.reason}
        {item.localTest && <span> · {copy.localTest}</span>}
        {item.reportSha256 && <code> {item.reportSha256}</code>}
      </li>)}</ul></details>
    </>}
    {role !== "superadmin" && <p>{copy.restricted}</p>}
  </section>;
}
export function PreparationSettingsForm({view,copy,busy,role,onSubmit}: {view:PreparationSettingsView;copy:typeof preparationSettingsMessages.en;
  busy:boolean;role:UserRole;onSubmit:(event:FormEvent<HTMLFormElement>)=>void}) {
  return <form onSubmit={onSubmit}><fieldset disabled={busy || role!=="superadmin"}>
    <ProfileFields view={view} copy={copy} />
    <fieldset><legend>{copy.capacity}</legend>{(Object.keys(view.capacity) as Array<keyof typeof view.capacity>).map(key=>
      <label className="field" key={key}><span>{copy[key]}</span><input type="number" name={key} min={key==="providerTokensPerMinute" ? 250000 : 1}
        max={{generationSlots:64,reviewSlots:32,providerSlots:64,queueLimit:1000,perUserWaiting:10,providerRequestsPerMinute:100000,providerTokensPerMinute:1000000000,voiceReservePercent:90}[key]}
        defaultValue={view.capacity[key]} required /></label>)}</fieldset>
    <label className="field"><span>{copy.reason}</span><textarea name="reason" maxLength={500} /></label>
    <button className="primary-button" type="submit">{copy.save}</button>
  </fieldset></form>;
}
function ProfileFields({ view, copy }: { view: PreparationSettingsView; copy: typeof preparationSettingsMessages.en }) {
  const [model, setModel] = useState(view.policy.generation.model);
  const [fast, setFast] = useState(view.policy.generation.serviceTier === "fast");
  return <>
    <label className="field"><span>{copy.model}</span><select name="model" value={model} onChange={event => setModel(preparationModelSchema.parse(event.target.value))}>
      {preparationModelSchema.options.map(value => <option key={value} value={value}>{value}</option>)}
    </select></label>
    <label><input name="fast" type="checkbox" checked={fast} onChange={event => setFast(event.target.checked)} /> {copy.fast}</label>
  </>;
}
