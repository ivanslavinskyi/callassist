"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import {
  completePasswordRecovery,
  login,
  registerAccount,
  resendPhoneVerification,
  startPasswordRecovery,
  verifyPasswordRecovery,
  verifyPhone
} from "@/lib/api";
import { authMessages, getAuthErrorMessage } from "@/lib/i18n/auth-messages";
import { useUiLocale } from "@/components/ui-locale-provider";

function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <AppShell>
      <main className="auth-page" id="main-content">
        <section className="auth-card">{children}</section>
      </main>
    </AppShell>
  );
}

function SubmitButton({ busy, busyLabel, label }: {
  busy: boolean;
  busyLabel: string;
  label: string;
}) {
  return (
    <button className="primary-button auth-submit" disabled={busy} type="submit">
      <span>{busy ? busyLabel : label}</span>
      <span aria-hidden="true">→</span>
    </button>
  );
}

export function RegistrationForm() {
  const router = useRouter();
  const { locale, localizeHref } = useUiLocale();
  const copy = authMessages[locale];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    try {
      await registerAccount({
        firstName: String(data.get("firstName") ?? "").trim(),
        lastName: String(data.get("lastName") ?? "").trim(),
        email,
        phoneE164: String(data.get("phoneE164") ?? "").trim(),
        password: String(data.get("password") ?? ""),
        uiLocale: locale
      });
      router.push(`${localizeHref("/verify")}?email=${encodeURIComponent(email)}`);
    } catch (caught) {
      setError(getAuthErrorMessage(caught, locale));
      setBusy(false);
    }
  }

  return (
    <AuthFrame>
      <h1>{copy.register.title}</h1>
      <p className="auth-intro">{copy.register.intro}</p>
      <form className="auth-form" onSubmit={submit}>
        <div className="auth-name-grid">
          <label className="field">
            <span>{copy.register.firstName}</span>
            <input autoComplete="given-name" maxLength={80} name="firstName" placeholder={copy.register.firstNamePlaceholder} required />
          </label>
          <label className="field">
            <span>{copy.register.lastName}</span>
            <input autoComplete="family-name" maxLength={80} name="lastName" placeholder={copy.register.lastNamePlaceholder} required />
          </label>
        </div>
        <label className="field">
          <span>{copy.register.email}</span>
          <input autoComplete="email" maxLength={320} name="email" required type="email" />
        </label>
        <label className="field">
          <span>{copy.register.phone}</span>
          <input autoComplete="tel" inputMode="tel" name="phoneE164" pattern="\+[1-9][0-9]{7,14}" placeholder={copy.register.phonePlaceholder} required type="tel" />
          <small>{copy.register.phoneHelp}</small>
        </label>
        <label className="field">
          <span>{copy.register.password}</span>
          <input autoComplete="new-password" maxLength={128} minLength={12} name="password" required type="password" />
          <small>{copy.register.passwordHelp}</small>
        </label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <SubmitButton busy={busy} busyLabel={copy.register.submitting} label={copy.register.submit} />
      </form>
      <p className="auth-alternative">{copy.register.existing} <Link href={localizeHref("/login")}>{copy.register.signIn}</Link></p>
    </AuthFrame>
  );
}

export function VerificationForm({ initialEmail }: { initialEmail: string }) {
  const router = useRouter();
  const { locale, localizeHref } = useUiLocale();
  const copy = authMessages[locale];
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [email, setEmail] = useState(initialEmail);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const data = new FormData(event.currentTarget);
    try {
      await verifyPhone({ email, code: String(data.get("code") ?? "").trim() });
      router.push(localizeHref("/app"));
      router.refresh();
    } catch (caught) {
      setError(getAuthErrorMessage(caught, locale));
      setBusy(false);
    }
  }

  async function resend() {
    setResending(true);
    setError(null);
    setNotice(null);
    try {
      await resendPhoneVerification({ email });
      setNotice(copy.verify.resent);
    } catch (caught) {
      setError(getAuthErrorMessage(caught, locale));
    } finally {
      setResending(false);
    }
  }

  return (
    <AuthFrame>
      <h1>{copy.verify.title}</h1>
      <p className="auth-intro">{copy.verify.intro}</p>
      <form className="auth-form" onSubmit={submit}>
        <label className="field">
          <span>{copy.verify.email}</span>
          <input autoComplete="email" maxLength={320} onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
        </label>
        <label className="field">
          <span>{copy.verify.code}</span>
          <input autoComplete="one-time-code" inputMode="numeric" maxLength={10} minLength={4} name="code" pattern="[0-9]{4,10}" placeholder={copy.verify.codePlaceholder} required />
        </label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {notice ? <p className="auth-success" role="status">{notice}</p> : null}
        <SubmitButton busy={busy} busyLabel={copy.verify.submitting} label={copy.verify.submit} />
        <button className="text-button auth-text-button" disabled={busy || resending || !email} onClick={resend} type="button">
          {resending ? copy.verify.resending : copy.verify.resend}
        </button>
      </form>
      <p className="auth-alternative"><Link href={localizeHref("/register")}>{copy.verify.back}</Link></p>
    </AuthFrame>
  );
}

export function LoginForm() {
  const router = useRouter();
  const { locale, localizeHref } = useUiLocale();
  const copy = authMessages[locale];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verificationEmail, setVerificationEmail] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setVerificationEmail(null);
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    try {
      await login({ email, password: String(data.get("password") ?? "") });
      router.push(localizeHref("/app"));
      router.refresh();
    } catch (caught) {
      setError(getAuthErrorMessage(caught, locale));
      if (caught instanceof Error && "code" in caught && caught.code === "PHONE_VERIFICATION_REQUIRED") {
        setVerificationEmail(email);
      }
      setBusy(false);
    }
  }

  return (
    <AuthFrame>
      <h1>{copy.login.title}</h1>
      <p className="auth-intro">{copy.login.intro}</p>
      <form className="auth-form" onSubmit={submit}>
        <label className="field">
          <span>{copy.login.email}</span>
          <input autoComplete="email" maxLength={320} name="email" required type="email" />
        </label>
        <label className="field">
          <span>{copy.login.password}</span>
          <input autoComplete="current-password" maxLength={128} name="password" required type="password" />
        </label>
        <Link className="auth-inline-link" href={localizeHref("/recover")}>{copy.login.forgot}</Link>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {verificationEmail ? <Link className="auth-inline-link" href={`${localizeHref("/verify")}?email=${encodeURIComponent(verificationEmail)}`}>{copy.login.verify}</Link> : null}
        <SubmitButton busy={busy} busyLabel={copy.login.submitting} label={copy.login.submit} />
      </form>
      <p className="auth-alternative">{copy.login.newAccount} <Link href={localizeHref("/register")}>{copy.login.register}</Link></p>
    </AuthFrame>
  );
}

type RecoveryStage = "start" | "verify" | "reset" | "success";

export function PasswordRecoveryForm() {
  const { locale, localizeHref } = useUiLocale();
  const copy = authMessages[locale];
  const [stage, setStage] = useState<RecoveryStage>("start");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryId, setRecoveryId] = useState<string | null>(null);
  const [recoveryToken, setRecoveryToken] = useState<string | null>(null);

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    try {
      const result = await startPasswordRecovery({
        email: String(data.get("email") ?? "").trim()
      });
      setRecoveryId(result.recoveryId);
      setStage("verify");
    } catch (caught) {
      setError(getAuthErrorMessage(caught, locale));
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!recoveryId) return restart();
    setBusy(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    try {
      const result = await verifyPasswordRecovery({
        recoveryId,
        code: String(data.get("code") ?? "").trim()
      });
      setRecoveryToken(result.recoveryToken);
      setRecoveryId(null);
      setStage("reset");
    } catch (caught) {
      setError(getAuthErrorMessage(caught, locale));
    } finally {
      setBusy(false);
    }
  }

  async function complete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!recoveryToken) return restart();
    const data = new FormData(event.currentTarget);
    const newPassword = String(data.get("newPassword") ?? "");
    if (newPassword !== String(data.get("confirmPassword") ?? "")) {
      setError(copy.errors.passwordMismatch);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await completePasswordRecovery({ recoveryToken, newPassword });
      setRecoveryToken(null);
      setStage("success");
    } catch (caught) {
      setError(getAuthErrorMessage(caught, locale));
    } finally {
      setBusy(false);
    }
  }

  function restart() {
    setRecoveryId(null);
    setRecoveryToken(null);
    setError(null);
    setBusy(false);
    setStage("start");
  }

  if (stage === "success") {
    return (
      <AuthFrame>
        <h1>{copy.recovery.successTitle}</h1>
        <p className="auth-intro" role="status">{copy.recovery.successIntro}</p>
        <Link className="primary-button auth-submit" href={localizeHref("/login")}>{copy.recovery.signIn}</Link>
      </AuthFrame>
    );
  }

  if (stage === "verify") {
    return (
      <AuthFrame>
        <h1>{copy.recovery.codeTitle}</h1>
        <p className="auth-intro">{copy.recovery.codeIntro}</p>
        <form className="auth-form" onSubmit={verify}>
          <label className="field">
            <span>{copy.recovery.code}</span>
            <input autoComplete="one-time-code" inputMode="numeric" maxLength={10} minLength={4} name="code" pattern="[0-9]{4,10}" placeholder={copy.recovery.codePlaceholder} required />
          </label>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <SubmitButton busy={busy} busyLabel={copy.recovery.verifying} label={copy.recovery.verify} />
          <button className="text-button auth-text-button" disabled={busy} onClick={restart} type="button">{copy.recovery.restart}</button>
        </form>
      </AuthFrame>
    );
  }

  if (stage === "reset") {
    return (
      <AuthFrame>
        <h1>{copy.recovery.resetTitle}</h1>
        <p className="auth-intro">{copy.recovery.resetIntro}</p>
        <form className="auth-form" onSubmit={complete}>
          <label className="field">
            <span>{copy.recovery.password}</span>
            <input autoComplete="new-password" maxLength={128} minLength={12} name="newPassword" required type="password" />
            <small>{copy.recovery.passwordHelp}</small>
          </label>
          <label className="field">
            <span>{copy.recovery.confirmPassword}</span>
            <input autoComplete="new-password" maxLength={128} minLength={12} name="confirmPassword" required type="password" />
          </label>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <SubmitButton busy={busy} busyLabel={copy.recovery.completing} label={copy.recovery.complete} />
          <button className="text-button auth-text-button" disabled={busy} onClick={restart} type="button">{copy.recovery.restart}</button>
        </form>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame>
      <h1>{copy.recovery.title}</h1>
      <p className="auth-intro">{copy.recovery.intro}</p>
      <form className="auth-form" onSubmit={start}>
        <label className="field">
          <span>{copy.recovery.email}</span>
          <input autoComplete="email" maxLength={320} name="email" required type="email" />
        </label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <SubmitButton busy={busy} busyLabel={copy.recovery.starting} label={copy.recovery.start} />
      </form>
      <p className="auth-alternative"><Link href={localizeHref("/login")}>{copy.recovery.back}</Link></p>
    </AuthFrame>
  );
}
