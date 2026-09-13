"use client";

import type { AdminOutboundCallControl, UserRole } from "@callassist/contracts";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { getAdminOutboundCalls, setAdminOutboundCalls } from "@/lib/api";
import { adminOperationsMessages } from "@/lib/i18n/admin-operations-messages";

// Load the safety control independently of diagnostics, queues and telemetry.
export function AdminOutboundControl({ role }: { role: UserRole }) {
  const copy = adminOperationsMessages.en;
  const [control, setControl] = useState<AdminOutboundCallControl | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestVersion = useRef(0);

  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setError(null);
    try {
      const result = await getAdminOutboundCalls();
      if (version === requestVersion.current) setControl(result.outboundCalls);
    } catch {
      if (version === requestVersion.current) {
        setControl(null);
        setError(copy.controlLoadError);
      }
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [copy.controlLoadError]);

  const invalidatePendingRequests = useCallback(() => {
    requestVersion.current++;
  }, []);

  useEffect(() => {
    void refresh();
    return invalidatePendingRequests;
  }, [refresh, invalidatePendingRequests]);

  async function changeControl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    // An unknown state must only offer the safe, explicit disable operation.
    const enabled = control?.enabled === false;
    const reason = String(new FormData(form).get("reason") ?? "").trim();
    if (loading || applying || (enabled && role !== "superadmin")) return;
    if (reason.length < 3) return;
    if (!window.confirm(enabled ? copy.confirmEnable : copy.confirmDisable)) return;
    const version = ++requestVersion.current;
    setApplying(true);
    setError(null);
    try {
      const result = await setAdminOutboundCalls({ enabled, reason });
      if (version !== requestVersion.current) return;
      setControl(result.outboundCalls);
      form.reset();
    } catch {
      if (version === requestVersion.current) {
        // A lost response can follow a successful write. Do not claim it failed
        // or render the pre-request state as the current control value.
        setControl(null);
        setError(copy.controlError);
      }
    } finally {
      if (version === requestVersion.current) setApplying(false);
    }
  }

  const enableAction = control?.enabled === false;
  return (
    <section className="admin-outbound-control" id="outbound-control" data-enabled={control?.enabled} aria-busy={loading || applying}>
      <div>
        <span className="admin-control-state" role="status">
          {control === null ? copy.outboundUnknown : control.enabled ? copy.outboundEnabled : copy.outboundDisabled}
        </span>
        <h2>{copy.outboundTitle}</h2>
        <p>{copy.controlHelp}</p>
        {control ? <dl className="admin-operations-list">
          <div><dt>{copy.outboundReason}</dt><dd>{control.reason}</dd></div>
          <div><dt>{copy.outboundUpdated}</dt><dd>{control.updatedAt
            ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "medium" }).format(new Date(control.updatedAt))
            : copy.notAvailable}</dd></div>
        </dl> : null}
        <button className="secondary-button" disabled={loading || applying} onClick={() => void refresh()} type="button">
          {loading ? copy.refreshing : copy.refreshControl}
        </button>
      </div>
      <form onSubmit={changeControl}>
        <label className="field">
          <span>{copy.controlReason}</span>
          <textarea disabled={loading || applying} maxLength={500} minLength={3} name="reason" placeholder={copy.controlReasonPlaceholder} required rows={3} />
        </label>
        <button
          className={enableAction ? "primary-button" : "danger-button"}
          disabled={loading || applying || (enableAction && role !== "superadmin")}
          type="submit"
        >
          {applying ? copy.applyingControl : enableAction ? copy.enableCalls : copy.disableCalls}
        </button>
        {enableAction && role !== "superadmin" ? <small>{copy.enableRestricted}</small> : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </form>
    </section>
  );
}
