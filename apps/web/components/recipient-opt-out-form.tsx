"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { AppShell } from "@/components/app-shell";
import { useUiLocale } from "@/components/ui-locale-provider";
import {
  confirmRecipientOptOut,
  requestRecipientOptOut
} from "@/lib/api";
import {
  getOptOutErrorMessage,
  optOutMessages
} from "@/lib/i18n/opt-out-messages";

type Step = "phone" | "verification" | "complete";

export function RecipientOptOutForm() {
  const { locale, localizeHref } = useUiLocale();
  const copy = optOutMessages[locale];
  const [step, setStep] = useState<Step>("phone");
  const [phoneE164, setPhoneE164] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await requestRecipientOptOut({ phoneE164: phoneE164.trim() });
      setStep("verification");
    } catch (caught) {
      setError(getOptOutErrorMessage(caught, locale));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    try {
      await confirmRecipientOptOut({
        phoneE164: phoneE164.trim(),
        code: String(data.get("code") ?? "").trim()
      });
      setStep("complete");
    } catch (caught) {
      setError(getOptOutErrorMessage(caught, locale));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <main className="auth-page" id="main-content">
        <section className="auth-card">
          <span className="eyebrow">{copy.eyebrow}</span>
          {step === "complete" ? (
            <>
              <h1>{copy.successTitle}</h1>
              <p className="auth-intro">{copy.success}</p>
              <Link className="primary-button auth-submit" href={localizeHref("/")}>
                <span>{copy.done}</span>
                <span aria-hidden="true">→</span>
              </Link>
            </>
          ) : step === "verification" ? (
            <>
              <h1>{copy.verifyTitle}</h1>
              <p className="auth-intro">{copy.verifyIntro(phoneE164)}</p>
              <form className="auth-form" onSubmit={confirm}>
                <label className="field">
                  <span>{copy.code}</span>
                  <input
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    maxLength={10}
                    minLength={4}
                    name="code"
                    pattern="[0-9]{4,10}"
                    placeholder={copy.codePlaceholder}
                    required
                  />
                </label>
                {error ? <p className="form-error" role="alert">{error}</p> : null}
                <button className="primary-button auth-submit" disabled={busy} type="submit">
                  <span>{busy ? copy.confirming : copy.confirm}</span>
                  <span aria-hidden="true">→</span>
                </button>
                <button
                  className="text-button auth-text-button"
                  disabled={busy}
                  onClick={() => {
                    setError(null);
                    setStep("phone");
                  }}
                  type="button"
                >
                  {copy.changePhone}
                </button>
              </form>
            </>
          ) : (
            <>
              <h1>{copy.title}</h1>
              <p className="auth-intro">{copy.intro}</p>
              <form className="auth-form" onSubmit={requestCode}>
                <label className="field">
                  <span>{copy.phone}</span>
                  <input
                    autoComplete="tel"
                    inputMode="tel"
                    maxLength={40}
                    onChange={(event) => setPhoneE164(event.target.value)}
                    placeholder={copy.phonePlaceholder}
                    required
                    type="tel"
                    value={phoneE164}
                  />
                  <small>{copy.phoneHelp}</small>
                </label>
                {error ? <p className="form-error" role="alert">{error}</p> : null}
                <button className="primary-button auth-submit" disabled={busy} type="submit">
                  <span>{busy ? copy.sending : copy.send}</span>
                  <span aria-hidden="true">→</span>
                </button>
              </form>
            </>
          )}
        </section>
      </main>
    </AppShell>
  );
}
