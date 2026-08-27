"use client";

import { useRef, useState, type FormEvent } from "react";
import { createPromoCode, grantCreditsAsAdmin } from "@/lib/api";
import { creditMessages, getCreditErrorMessage } from "@/lib/i18n/credit-messages";

type Busy = "promo" | "grant" | null;

export function AdminCreditsForm() {
  const locale = "en" as const;
  const copy = creditMessages[locale];
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const promoKey = useRef<string | null>(null);
  const grantKey = useRef<string | null>(null);

  async function createPromo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const code = String(data.get("code") ?? "").trim().toUpperCase();
    promoKey.current ??= crypto.randomUUID();
    setBusy("promo");
    setError(null);
    setNotice(null);
    try {
      await createPromoCode({
        code,
        credits: Number(data.get("credits")),
        globalRedemptionLimit: optionalNumber(data.get("globalRedemptionLimit")),
        perUserLimit: Number(data.get("perUserLimit")),
        startsAt: optionalDate(data.get("startsAt")),
        expiresAt: optionalDate(data.get("expiresAt")),
        active: data.get("active") === "on",
        campaign: String(data.get("campaign") ?? "").trim(),
        reason: String(data.get("reason") ?? "").trim(),
        idempotencyKey: promoKey.current
      });
      setNotice(copy.createSuccess(code));
      form.reset();
      promoKey.current = null;
    } catch (caught) {
      setError(getCreditErrorMessage(caught, locale));
    } finally {
      setBusy(null);
    }
  }

  async function grant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const targetEmail = String(data.get("targetEmail") ?? "").trim().toLowerCase();
    const credits = Number(data.get("credits"));
    grantKey.current ??= crypto.randomUUID();
    setBusy("grant");
    setError(null);
    setNotice(null);
    try {
      await grantCreditsAsAdmin({
        targetEmail,
        credits,
        reason: String(data.get("reason") ?? "").trim(),
        idempotencyKey: grantKey.current
      });
      setNotice(copy.grantSuccess(credits, targetEmail));
      form.reset();
      grantKey.current = null;
    } catch (caught) {
      setError(getCreditErrorMessage(caught, locale));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="auth-page" id="main-content">
        <section className="auth-card credits-admin-card">
          <span className="eyebrow">{copy.adminEyebrow}</span>
            <>
              <h1>{copy.adminTitle}</h1>
              <p className="auth-intro">{copy.adminIntro}</p>
              <div className="safety-form-grid">
                <form className="auth-form safety-form" onChange={() => { promoKey.current = null; }} onSubmit={createPromo}>
                  <FormHeading title={copy.createTitle} help={copy.createHelp} />
                  <TextField label={copy.code} name="code" placeholder={copy.codePlaceholder} maxLength={64} minLength={8} />
                  <NumberField label={copy.credits} name="credits" min={1} max={100} defaultValue={3} />
                  <NumberField label={copy.globalLimit} name="globalRedemptionLimit" min={1} max={100000} />
                  <NumberField label={copy.perUserLimit} name="perUserLimit" min={1} max={10} defaultValue={1} />
                  <TextField label={copy.campaign} name="campaign" placeholder={copy.campaignPlaceholder} maxLength={120} />
                  <label className="field"><span>{copy.startsAt}</span><input name="startsAt" type="datetime-local" /></label>
                  <label className="field"><span>{copy.expiresAt}</span><input name="expiresAt" type="datetime-local" /></label>
                  <label className="credit-checkbox"><input defaultChecked name="active" type="checkbox" /><span>{copy.active}</span></label>
                  <ReasonField label={copy.reason} name="reason" placeholder={copy.createReasonPlaceholder} />
                  <button className="primary-button" disabled={busy !== null} type="submit">{busy === "promo" ? copy.creating : copy.create}</button>
                </form>
                <form className="auth-form safety-form" onChange={() => { grantKey.current = null; }} onSubmit={grant}>
                  <FormHeading title={copy.grantTitle} help={copy.grantHelp} />
                  <label className="field"><span>{copy.targetEmail}</span><input autoComplete="email" maxLength={320} name="targetEmail" required type="email" /></label>
                  <NumberField label={copy.credits} name="credits" min={1} max={100} defaultValue={1} />
                  <ReasonField label={copy.reason} name="reason" placeholder={copy.grantReasonPlaceholder} />
                  <button className="secondary-button" disabled={busy !== null} type="submit">{busy === "grant" ? copy.granting : copy.grant}</button>
                </form>
              </div>
              {error ? <p className="form-error" role="alert">{error}</p> : null}
              {notice ? <p className="auth-success" role="status">{notice}</p> : null}
            </>
        </section>
    </main>
  );
}

function FormHeading({ title, help }: { title: string; help: string }) {
  return <div><h2>{title}</h2><p>{help}</p></div>;
}

function TextField(props: { label: string; name: string; placeholder: string; minLength?: number; maxLength: number }) {
  const { label, ...inputProps } = props;
  return <label className="field"><span>{label}</span><input {...inputProps} required /></label>;
}

function NumberField(props: { label: string; name: string; min: number; max: number; defaultValue?: number }) {
  const { label, ...inputProps } = props;
  return <label className="field"><span>{label}</span><input {...inputProps} required={props.defaultValue !== undefined} type="number" /></label>;
}

function ReasonField({ label, name, placeholder }: { label: string; name: string; placeholder: string }) {
  return <label className="field"><span>{label}</span><textarea maxLength={500} minLength={3} name={name} placeholder={placeholder} required rows={3} /></label>;
}

function optionalNumber(value: FormDataEntryValue | null) {
  return value === null || value === "" ? null : Number(value);
}

function optionalDate(value: FormDataEntryValue | null) {
  return value === null || value === "" ? null : new Date(String(value)).toISOString();
}
