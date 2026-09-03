"use client";

import type { OnboardingStatus } from "@callassist/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { AppShell } from "./app-shell";
import { useUiLocale } from "./ui-locale-provider";
import { acceptOnboarding, ApiError, logout } from "@/lib/api";
import { contentPath } from "@/lib/i18n/content-routing";
import { onboardingMessages } from "@/lib/i18n/onboarding-messages";

export function OnboardingForm({ initialStatus }: {
  initialStatus: OnboardingStatus;
}) {
  const router = useRouter();
  const { locale, localizeHref } = useUiLocale();
  const copy = onboardingMessages[locale];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await acceptOnboarding({
        locale,
        termsRevisionId: initialStatus.current.terms.id,
        acceptableUseRevisionId: initialStatus.current.acceptableUse.id,
        acceptTerms: true,
        acceptAcceptableUse: true,
        // Legacy compatibility fields remain required by the immutable
        // acceptance schema, but are no longer separate user agreements.
        acknowledgeConsent: true,
        acknowledgeRetention: true,
        acknowledgeUseLimits: true,
        acknowledgeCredits: true
      });
      router.replace(localizeHref("/app"));
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "LEGAL_REVISION_CHANGED") {
        setError(copy.changed);
        router.refresh();
      } else {
        setError(copy.error);
      }
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    setError(null);
    try {
      await logout();
      router.replace(localizeHref("/"));
      router.refresh();
    } catch {
      setError(copy.signOutError);
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <main className="onboarding-page" id="main-content" tabIndex={-1}>
        <header className="onboarding-heading">
          <span className="eyebrow">{copy.eyebrow}</span>
          <h1>{copy.title}</h1>
          <p>{copy.intro}</p>
          <div className="onboarding-documents">
            <Link href={`/${locale}/${initialStatus.current.terms.slug}`} rel="noreferrer" target="_blank">
              <strong>{copy.terms}</strong>
              <span aria-hidden="true">↗</span>
            </Link>
            <Link href={`/${locale}/${initialStatus.current.acceptableUse.slug}`} rel="noreferrer" target="_blank">
              <strong>{copy.acceptableUse}</strong>
              <span aria-hidden="true">↗</span>
            </Link>
            <Link href={contentPath(locale, "privacy")} rel="noreferrer" target="_blank">
              <strong>{copy.privacy}</strong>
              <span aria-hidden="true">↗</span>
            </Link>
          </div>
        </header>

        <form className="onboarding-form" onSubmit={submit}>
          <fieldset>
            <legend className="sr-only">{copy.title}</legend>
            <OnboardingCheck name="legalAgreement" text={copy.agreement} />
          </fieldset>
          <section className="onboarding-information">
            <h2>{copy.informationHeading}</h2>
            <ul>
              {copy.information.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </section>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div className="onboarding-actions">
            <button className="primary-button" disabled={busy} type="submit">
              {busy ? copy.submitting : copy.submit}
            </button>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={signOut}
              type="button"
            >
              {copy.signOut}
            </button>
          </div>
        </form>
      </main>
    </AppShell>
  );
}

function OnboardingCheck({ name, text }: { name: string; text: string }) {
  return (
    <label className="onboarding-check">
      <input name={name} required type="checkbox" />
      <span>{text}</span>
    </label>
  );
}
