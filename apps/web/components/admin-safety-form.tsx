"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { AppShell } from "@/components/app-shell";
import { useUiLocale } from "@/components/ui-locale-provider";
import {
  getCurrentUser,
  liftRecipientSuppressionAsStaff,
  suppressRecipientAsStaff
} from "@/lib/api";
import {
  getSafetyErrorMessage,
  safetyMessages
} from "@/lib/i18n/safety-messages";

type Access = "loading" | "allowed" | "forbidden";

export function AdminSafetyForm() {
  const { locale, localizeHref } = useUiLocale();
  const copy = safetyMessages[locale];
  const [access, setAccess] = useState<Access>("loading");
  const [busy, setBusy] = useState<"suppress" | "lift" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getCurrentUser()
      .then(({ user }) => {
        if (active) {
          setAccess(["admin", "superadmin"].includes(user.role)
            ? "allowed"
            : "forbidden");
        }
      })
      .catch(() => {
        if (active) setAccess("forbidden");
      });
    return () => { active = false; };
  }, []);

  async function suppress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy("suppress");
    setError(null);
    setNotice(null);
    const data = new FormData(form);
    try {
      const result = await suppressRecipientAsStaff({
        phoneE164: String(data.get("phoneE164") ?? "").trim(),
        source: String(data.get("source") ?? "staff") as "staff" | "complaint",
        reason: String(data.get("reason") ?? "").trim()
      });
      form.reset();
      setNotice(result.status === "suppressed"
        ? copy.suppressSuccess
        : copy.suppressUnchanged);
    } catch (caught) {
      setError(getSafetyErrorMessage(caught, locale));
    } finally {
      setBusy(null);
    }
  }

  async function lift(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy("lift");
    setError(null);
    setNotice(null);
    const data = new FormData(form);
    try {
      const result = await liftRecipientSuppressionAsStaff({
        phoneE164: String(data.get("phoneE164") ?? "").trim(),
        reason: String(data.get("reason") ?? "").trim()
      });
      form.reset();
      setNotice(result.status === "lifted"
        ? copy.liftSuccess
        : copy.liftUnchanged);
    } catch (caught) {
      setError(getSafetyErrorMessage(caught, locale));
    } finally {
      setBusy(null);
    }
  }

  return (
    <AppShell>
      <main className="auth-page" id="main-content">
        <section className="auth-card">
          <span className="eyebrow">{copy.eyebrow}</span>
          {access === "loading" ? (
            <p className="auth-intro" role="status">{copy.loading}</p>
          ) : access === "forbidden" ? (
            <>
              <h1>{copy.forbiddenTitle}</h1>
              <p className="auth-intro">{copy.forbidden}</p>
              <Link className="auth-inline-link" href={localizeHref("/login")}>
                {copy.signIn}
              </Link>
            </>
          ) : (
            <>
              <h1>{copy.title}</h1>
              <p className="auth-intro">{copy.intro}</p>
              <div className="safety-form-grid">
                <form className="auth-form safety-form" onSubmit={suppress}>
                  <div>
                    <h2>{copy.suppressTitle}</h2>
                    <p>{copy.suppressHelp}</p>
                  </div>
                  <PhoneField copy={copy} />
                  <label className="field">
                    <span>{copy.source}</span>
                    <select defaultValue="staff" name="source">
                      <option value="staff">{copy.staffSource}</option>
                      <option value="complaint">{copy.complaintSource}</option>
                    </select>
                  </label>
                  <ReasonField placeholder={copy.suppressReasonPlaceholder} title={copy.reason} />
                  <button className="primary-button" disabled={busy !== null} type="submit">
                    {busy === "suppress" ? copy.suppressing : copy.suppress}
                  </button>
                </form>
                <form className="auth-form safety-form" onSubmit={lift}>
                  <div>
                    <h2>{copy.liftTitle}</h2>
                    <p>{copy.liftHelp}</p>
                  </div>
                  <PhoneField copy={copy} />
                  <ReasonField placeholder={copy.liftReasonPlaceholder} title={copy.reason} />
                  <button className="secondary-button" disabled={busy !== null} type="submit">
                    {busy === "lift" ? copy.lifting : copy.lift}
                  </button>
                </form>
              </div>
              {error ? <p className="form-error" role="alert">{error}</p> : null}
              {notice ? <p className="auth-success" role="status">{notice}</p> : null}
            </>
          )}
        </section>
      </main>
    </AppShell>
  );
}

function PhoneField({ copy }: { copy: typeof safetyMessages.en }) {
  return (
    <label className="field">
      <span>{copy.phone}</span>
      <input
        autoComplete="tel"
        inputMode="tel"
        maxLength={40}
        name="phoneE164"
        placeholder={copy.phonePlaceholder}
        required
        type="tel"
      />
    </label>
  );
}

function ReasonField({ placeholder, title }: { placeholder: string; title: string }) {
  return (
    <label className="field">
      <span>{title}</span>
      <textarea maxLength={500} minLength={3} name="reason" placeholder={placeholder} required rows={3} />
    </label>
  );
}
