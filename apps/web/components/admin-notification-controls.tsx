"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { NotificationView } from "@callassist/contracts";
import { ApiError, getNotificationSettings, updateNotificationSettings } from "@/lib/api";
import styles from "./admin-notification-controls.module.css";

export function AdminNotificationControls() {
  const [view,setView]=useState<NotificationView|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [notice,setNotice]=useState<string|null>(null);
  const refresh=useCallback(async()=>{
    setBusy(true);
    try { setView(await getNotificationSettings()); setError(null); }
    catch(error) {
      setView(null);
      setError(error instanceof ApiError && error.code === "NOTIFICATIONS_UNAVAILABLE" ?
        "Notifications require PostgreSQL storage. This environment does not provide a persistent notification queue." :
        "Notification settings could not be loaded. Refresh to try again.");
    } finally {setBusy(false);}
  },[]);
  useEffect(()=>{void refresh();},[refresh]);
  async function save(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); if(!view||busy) return;
    const data=new FormData(event.currentTarget);
    const settings={enabled:data.has("enabled"),registrations:data.has("registrations"),calls:data.has("calls"),recipientUserIds:data.getAll("recipients").map(String)};
    if(settings.enabled && !settings.recipientUserIds.length) {setError("Select at least one verified superadmin recipient.");return;}
    setBusy(true);setError(null);setNotice(null);
    try {
      await updateNotificationSettings({settings,expectedRevision:view.revision,reason:String(data.get("reason")).trim()});
      await refresh();setNotice("Notification settings saved.");
    } catch(error) {
      setView(null);
      setError(error instanceof ApiError && error.code === "NOTIFICATION_SETTINGS_STALE" ?
        "Another operator changed these settings. Refresh and review the current values." :
        "The change could not be confirmed. Refresh to check its result before trying again.");
    } finally {setBusy(false);}
  }
  return <section className={`admin-system-panel ${styles.panel}`} id="superadmin-notifications" aria-busy={busy}>
    <div className={styles.heading}><div><h2>Superadmin notifications</h2>
      <p>Email reports for confirmed registrations and completed call attempts.</p></div>
      <button className="secondary-button" type="button" disabled={busy} onClick={()=>{setNotice(null);void refresh();}}>Refresh notifications</button></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {view && <>
      <form key={view.revision} onSubmit={save}><fieldset disabled={busy}>
        <legend>Email settings</legend>
        <label className={styles.checkbox}><input name="enabled" type="checkbox" defaultChecked={view.settings.enabled}/> Enable superadmin emails</label>
        <label className={styles.checkbox}><input name="registrations" type="checkbox" defaultChecked={view.settings.registrations}/> Confirmed registrations</label>
        <label className={styles.checkbox}><input name="calls" type="checkbox" defaultChecked={view.settings.calls}/> Completed call attempts, including unsuccessful calls</label>
        <fieldset className={styles.recipients}><legend>Recipients</legend>
          {view.recipients.length ? view.recipients.map(recipient=><label className={styles.checkbox} key={recipient.id}>
            <input type="checkbox" name="recipients" value={recipient.id} defaultChecked={view.settings.recipientUserIds.includes(recipient.id)}/>
            <span>{recipient.name} · {recipient.email}</span></label>) : <p>No eligible recipients. A superadmin needs a verified email and phone.</p>}
        </fieldset>
        <p>Disabling a category cancels its pending emails. Re-enabling applies to new events only. Emails already submitted cannot be recalled.</p>
        <p>Reports wait up to five minutes for analysis. Email labels are in English; source text and model output retain their original language.</p>
        <label className="field"><span>Reason for change</span><input name="reason" required minLength={3} maxLength={500}/></label>
        <button type="submit" className="primary-button">Save notification settings</button>
      </fieldset></form>
      <h3>Recent emails</h3>
      <p>Accepted means the mail provider accepted the email. It does not confirm inbox delivery.</p>
      {view.deliveries.length ? <ul className={styles.deliveries}>{view.deliveries.map(delivery=><li key={delivery.id}>
        <div><strong>{delivery.kind === "registration" ? "Registration" : "Call attempt"}</strong> · {delivery.status} · {delivery.attempts} attempt{delivery.attempts === 1 ? "" : "s"}</div>
        <div><time dateTime={delivery.createdAt}>{new Date(delivery.createdAt).toLocaleString("en-GB")}</time> · {view.recipients.find(r=>r.id===delivery.recipientUserId)?.email ?? "Recipient no longer eligible"}</div>
        {delivery.errorCode && <div>{delivery.errorCode}</div>}
        <details><summary>Delivery details</summary><p>Notification: {delivery.id}<br/>Source: {delivery.sourceId}<br/>Provider ID: {delivery.providerId ?? "Unavailable"}</p></details>
      </li>)}</ul> : <p>No notification emails yet.</p>}
    </>}
  </section>;
}
