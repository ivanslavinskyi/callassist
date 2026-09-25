"use client";

import Link from "next/link";
import type { RegistrationOptions } from "@callassist/contracts";
import { PhoneInput } from "./phone-input";
import { registrationCallMessages } from "@/lib/i18n/registration-call-messages";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { designMessages } from "@/lib/i18n/design-messages";
import { AppShell } from "@/components/app-shell";
import {
  ApiError,
  correctUnverifiedPhone,
  completePasswordRecovery,
  login,
  registerAccount,
  getRegistrationOptions,
  resendPhoneVerification,
  startPasswordRecovery,
  verifyPasswordRecovery,
  verifyPhone,
  updateLanguagePreferences
} from "@/lib/api";
import { authMessages, getAuthErrorMessage } from "@/lib/i18n/auth-messages";
import { betaMessages } from "@/lib/i18n/beta-messages";
import { useUiLocale } from "@/components/ui-locale-provider";
import { localizePathname } from "@/lib/i18n/routing";
import { clearExplicitGuestLocale, readExplicitGuestLocale, rememberUiLocale, resolvePostLoginLocale } from "@/lib/ui-language-preference";
import { UiIcon } from "@/components/ui-icon";

export function AuthFrame({ children }: { children: ReactNode }) {
  const { locale } = useUiLocale();
  const design = designMessages[locale];
  return (
    <AppShell>
      <main className="auth-page" id="main-content" tabIndex={-1}>
        <aside className="auth-aside">
          <span className="eyebrow">SHPROHLI</span>
          <h2>{design.authTitle}</h2><p>{design.authLead}</p>
          <div className="auth-aside-note"><p>{design.authCredits}</p><small>{design.authScope}</small></div>
        </aside>
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
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const extra = registrationCallMessages[locale];
  const [options, setOptions] = useState<RegistrationOptions | null>(null);
  const [optionsError, setOptionsError] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true; setOptions(null); setOptionsError(false);
    void getRegistrationOptions(locale).then(value => { if (active) setOptions(value); }).catch(() => { if (active) setOptionsError(true); });
    return () => { active = false; };
  }, [locale, reload]);
  const passwordLength = Math.min(password.length, 12);
  const passwordLengthLevel = password.length === 0 ? "empty" : password.length < 6 ? "short" : password.length < 12 ? "growing" : "ready";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    try {
      if (!options) throw new Error("Registration options unavailable");
      const docs = options.documents;
      const legalAcceptance = options.policy.onboarding === "registration" && docs && data.has("legalAgreement") ? {
        locale: docs.terms.locale, termsRevisionId: docs.terms.id, acceptableUseRevisionId: docs.acceptableUse.id,
        privacyRevisionId: docs.privacy.id, privacyLocale: docs.privacy.locale,
        acceptTerms: true as const, acceptAcceptableUse: true as const,
        acknowledgeConsent: true as const, acknowledgeRetention: true as const, acknowledgeUseLimits: true as const, acknowledgeCredits: true as const
      } : undefined;
      await registerAccount({
        legalAcceptance,
        firstName: String(data.get("firstName") ?? "").trim(),
        lastName: String(data.get("lastName") ?? "").trim(),
        email,
        phoneE164: String(data.get("phoneE164") ?? "").trim(),
        password: String(data.get("password") ?? ""),
        uiLocale: locale,
        ...(String(data.get("invitationCode") ?? "").trim() ? { invitationCode: String(data.get("invitationCode")).trim() } : {})
      });
      router.push(`${localizeHref("/verify")}?email=${encodeURIComponent(email)}`);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "LEGAL_REVISION_CHANGED") {
        setError(extra.legalChanged); setReload(value => value + 1);
      } else setError(getAuthErrorMessage(caught, locale));
      setBusy(false);
    }
  }

  return (
    <AuthFrame>
      <h1>{copy.register.title}</h1>
      <p className="auth-intro">{copy.register.intro}</p>
      <form className="auth-form" onSubmit={submit}>
        <label className="field">
          <span>{betaMessages[locale].invitation}</span>
          <input name="invitationCode" autoComplete="off" maxLength={43} minLength={43} spellCheck={false} aria-describedby="invitation-help" />
          <small id="invitation-help">{betaMessages[locale].invitationHelp}</small>
        </label>
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
          <PhoneInput name="phoneE164" countries={options?.smsCountries} />
          <small>{copy.register.phoneHelp}</small>
        </label>
        <div className="field registration-password-field">
          <label htmlFor="registration-password">{copy.register.password}</label>
          <div className="password-input-wrap">
            <input
              aria-describedby="registration-password-help"
              autoComplete="new-password"
              id="registration-password"
              maxLength={128}
              minLength={12}
              name="password"
              onChange={(event) => setPassword(event.target.value)}
              required
              type={passwordVisible ? "text" : "password"}
              value={password}
            />
            <button
              aria-label={passwordVisible ? copy.register.hidePassword : copy.register.showPassword}
              aria-pressed={passwordVisible}
              className="password-visibility-toggle"
              onClick={() => setPasswordVisible((visible) => !visible)}
              title={passwordVisible ? copy.register.hidePassword : copy.register.showPassword}
              type="button"
            >
              <UiIcon name={passwordVisible ? "eye" : "eye-slash"} />
            </button>
          </div>
          <div
            aria-label={copy.register.passwordLength}
            aria-valuemax={12}
            aria-valuemin={0}
            aria-valuenow={passwordLength}
            className="password-length-meter"
            role="meter"
          >
            <span data-level={passwordLengthLevel} style={{ width: `${passwordLength / 12 * 100}%` }} />
          </div>
          <small id="registration-password-help">{copy.register.passwordHelp}</small>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {options?.policy.onboarding === "registration" && options.documents ? <div key={`${locale}:${reload}`}>
          <label className="onboarding-check"><input type="checkbox" name="legalAgreement" required /><span>{extra.agreement}</span></label>
          <div className="registration-documents">{(["terms", "acceptableUse", "privacy"] as const).map(key => {
            const doc = options.documents![key];
            return <Link key={key} href={`/${doc.locale}/${doc.slug}`} target="_blank" rel="noreferrer">{extra[key]}</Link>;
          })}</div>
        </div> : null}
        {optionsError ? <p role="alert">{extra.optionsError} <button type="button" className="text-button" onClick={() => setReload(value => value + 1)}>{extra.reload}</button></p> : null}
        <SubmitButton busy={busy || !options || (options.policy.onboarding === "registration" && !options.documents)} busyLabel={copy.register.submitting} label={copy.register.submit} />
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
  const [resendSeconds, setResendSeconds] = useState(0);
  const [correctingPhone, setCorrectingPhone] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [registrationPassword, setRegistrationPassword] = useState("");
  useEffect(() => {
    const timer = window.setInterval(() => setResendSeconds((seconds) => Math.max(0, seconds - 1)), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const data = new FormData(event.currentTarget);
    try {
      if (correctingPhone) {
        await correctUnverifiedPhone({ email, currentPassword: registrationPassword, newPhoneE164: newPhone.trim(), uiLocale: locale });
        setRegistrationPassword(""); setCorrectingPhone(false); setResendSeconds(60); setNotice(copy.verify.resent); setBusy(false);
        return;
      }
      const { user } = await verifyPhone({ email, code: String(data.get("code") ?? "").trim() });
      const explicitGuestLocale = readExplicitGuestLocale(document.cookie);
      if (explicitGuestLocale) await updateLanguagePreferences({ uiLocale: explicitGuestLocale });
      const nextLocale = resolvePostLoginLocale({ explicitGuestLocale, accountLocale: user.uiLocale, pageLocale: locale });
      rememberUiLocale(nextLocale);
      clearExplicitGuestLocale();
      router.push(localizePathname(user.emailVerifiedAt ? "/app" : "/verify-email", nextLocale));
      router.refresh();
    } catch (caught) {
      setError(getAuthErrorMessage(caught, locale));
      setBusy(false);
    }
  }

  async function resend() {
    if (resending || resendSeconds > 0) return;
    setResending(true);
    setError(null);
    setNotice(null);
    try {
      await resendPhoneVerification({ email, uiLocale: locale });
      setResendSeconds(60);
      setNotice(copy.verify.resent);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "RATE_LIMITED") setResendSeconds(caught.retryAfterSeconds ?? 60);
      setError(getAuthErrorMessage(caught, locale));
    } finally {
      setResending(false);
    }
  }

  return (
    <AuthFrame>
      <h1>{copy.verify.title}</h1>
      <p className="auth-intro">{correctingPhone ? copy.verify.correctionHelp : copy.verify.intro}</p>
      <form className="auth-form" onSubmit={submit}>
        <label className="field">
          <span>{copy.verify.email}</span>
          <input autoComplete="email" maxLength={320} onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
        </label>
        {correctingPhone ? <>
          <label className="field"><span>{copy.verify.newPhone}</span><PhoneInput defaultValue={newPhone} onChange={setNewPhone} /></label>
          <label className="field"><span>{copy.verify.password}</span><input autoComplete="current-password" type="password" required maxLength={128} value={registrationPassword} onChange={(event) => setRegistrationPassword(event.target.value)} /></label>
        </> : <label className="field">
          <span>{copy.verify.code}</span>
          <input autoComplete="one-time-code" inputMode="numeric" maxLength={10} minLength={4} name="code" pattern="[0-9]{4,10}" placeholder={copy.verify.codePlaceholder} required />
        </label>}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {notice ? <p className="auth-success" role="status">{notice}</p> : null}
        <SubmitButton busy={busy} busyLabel={correctingPhone ? copy.verify.resending : copy.verify.submitting} label={correctingPhone ? copy.verify.resend : copy.verify.submit} />
        <small>{copy.verify.expiry}</small>
        {resendSeconds > 0 ? <p>{copy.verify.wait.replace("{seconds}", String(resendSeconds))}</p> : null}
        {!correctingPhone ? <button className="text-button auth-text-button" disabled={busy || resending || resendSeconds > 0 || !email} onClick={resend} type="button">
          {resending ? copy.verify.resending : copy.verify.resend}
        </button> : null}
        <button className="text-button auth-text-button" disabled={busy || resending} type="button" onClick={() => { setCorrectingPhone(!correctingPhone); setRegistrationPassword(""); setError(null); setNotice(null); }}>{correctingPhone ? copy.verify.cancelCorrection : copy.verify.correctPhone}</button>
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
      const { user } = await login({ email, password: String(data.get("password") ?? "") });
      const explicitGuestLocale = readExplicitGuestLocale(document.cookie);
      if (explicitGuestLocale) await updateLanguagePreferences({ uiLocale: explicitGuestLocale });
      const nextLocale = resolvePostLoginLocale({ explicitGuestLocale, accountLocale: user.uiLocale, pageLocale: locale });
      rememberUiLocale(nextLocale);
      clearExplicitGuestLocale();
      const policy = await getRegistrationOptions(nextLocale);
      const canContinue = user.emailVerifiedAt || (user.emailVerificationDeferredAt && policy.policy.emailVerification === "deferrable");
      router.push(localizePathname(canContinue ? "/app" : "/verify-email", nextLocale));
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
  const [verificationCode, setVerificationCode] = useState("");

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    try {
      const result = await startPasswordRecovery({
        email: String(data.get("email") ?? "").trim(), uiLocale: locale
      });
      setRecoveryId(result.recoveryId);
      setVerificationCode("");
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
    const code = String(new FormData(event.currentTarget).get("code") ?? "").trim();
    if (!/^\d{4,10}$/.test(code)) {
      setVerificationCode("");
      setError(copy.errors.invalidVerification);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await verifyPasswordRecovery({
        recoveryId,
        code
      });
      setRecoveryToken(result.recoveryToken);
      setRecoveryId(null);
      setVerificationCode("");
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
    setVerificationCode("");
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
        <form className="auth-form" key="recovery-code" onSubmit={verify}>
          <label className="field">
            <span>{copy.recovery.code}</span>
            <input
              autoComplete="one-time-code"
              id="password-recovery-sms-code"
              inputMode="numeric"
              maxLength={10}
              minLength={4}
              name="code"
              onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 10))}
              pattern="[0-9]{4,10}"
              placeholder={copy.recovery.codePlaceholder}
              required
              type="text"
              value={verificationCode}
            />
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
        <form className="auth-form" key="recovery-reset" onSubmit={complete}>
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
      <form className="auth-form" key="recovery-email" onSubmit={start}>
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
