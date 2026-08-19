"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AppShell } from "@/components/app-shell";
import { useUiLocale } from "@/components/ui-locale-provider";
import { getCurrentUser, redeemPromoCode } from "@/lib/api";
import { creditMessages, getCreditErrorMessage } from "@/lib/i18n/credit-messages";

type Access = "loading" | "allowed" | "forbidden";

export function PromoRedemptionForm() {
  const { locale, localizeHref } = useUiLocale();
  const copy = creditMessages[locale];
  const [access, setAccess] = useState<Access>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const idempotencyKey = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    void getCurrentUser()
      .then(() => { if (active) setAccess("allowed"); })
      .catch(() => { if (active) setAccess("forbidden"); });
    return () => { active = false; };
  }, []);

  async function redeem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    idempotencyKey.current ??= crypto.randomUUID();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await redeemPromoCode({
        code: String(data.get("code") ?? "").trim(),
        idempotencyKey: idempotencyKey.current
      });
      const grant = result.usage.transactions.find(({ type }) => type === "promo_grant");
      setNotice(copy.redeemSuccess(grant?.amount ?? 0));
      form.reset();
      idempotencyKey.current = null;
    } catch (caught) {
      setError(getCreditErrorMessage(caught, locale));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <main className="auth-page" id="main-content">
        <section className="auth-card">
          <span className="eyebrow">{copy.redeemEyebrow}</span>
          {access === "loading" ? (
            <p className="auth-intro" role="status">{copy.loading}</p>
          ) : access === "forbidden" ? (
            <>
              <h1>{copy.signInTitle}</h1>
              <p className="auth-intro">{copy.signIn}</p>
              <Link className="auth-inline-link" href={localizeHref("/login")}>{copy.signInTitle}</Link>
            </>
          ) : (
            <>
              <h1>{copy.redeemTitle}</h1>
              <p className="auth-intro">{copy.redeemIntro}</p>
              <form className="auth-form" onChange={() => { idempotencyKey.current = null; }} onSubmit={redeem}>
                <label className="field">
                  <span>{copy.code}</span>
                  <input
                    autoCapitalize="characters"
                    autoComplete="off"
                    maxLength={64}
                    minLength={8}
                    name="code"
                    pattern="[A-Za-z0-9][A-Za-z0-9_-]*"
                    placeholder={copy.codePlaceholder}
                    required
                  />
                </label>
                <button className="primary-button auth-submit" disabled={busy} type="submit">
                  {busy ? copy.redeeming : copy.redeem}
                </button>
                {error ? <p className="form-error" role="alert">{error}</p> : null}
                {notice ? <p className="auth-success" role="status">{notice}</p> : null}
              </form>
            </>
          )}
        </section>
      </main>
    </AppShell>
  );
}
