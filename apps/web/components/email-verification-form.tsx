"use client";
import type { User } from "@callassist/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { ApiError, startEmailVerification, confirmEmailVerification, startEmailChange, confirmEmailChange, getCurrentUser } from "@/lib/api";
import { emailVerificationMessages } from "@/lib/i18n/email-verification-messages";
import { useUiLocale } from "./ui-locale-provider";

export function EmailVerificationForm({ initialUser }: { initialUser: User }) {
  const { locale, localizeHref } = useUiLocale();
  const copy = emailVerificationMessages[locale];
  const router = useRouter();
  const [user, setUser] = useState(initialUser);
  const [correcting, setCorrecting] = useState(false);
  const [email, setEmail] = useState(initialUser.email);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<{ id: string; expiresAt: string; change: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const remaining = Math.max(0, Math.ceil((cooldownUntil - now) / 1_000));
  const expired = Boolean(challenge && now >= Date.parse(challenge.expiresAt));

  function showError(caught: unknown) {
    if (!(caught instanceof ApiError)) return setError(copy.error);
    if (caught.code === "RATE_LIMITED") {
      setNow(Date.now()); setCooldownUntil(Date.now() + (caught.retryAfterSeconds ?? 60) * 1_000);
      return setError(copy.limited);
    }
    setError(caught.code === "AUTHENTICATION_REQUIRED" ? copy.session
      : caught.code === "INVALID_CREDENTIALS" ? copy.credentials
      : caught.code === "INVALID_EMAIL_CHANGE" || caught.code === "INVALID_EMAIL_VERIFICATION" ? copy.invalid
      : caught.code === "EMAIL_CHANGE_NOT_AVAILABLE" ? copy.unavailable : copy.error);
  }

  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (busy || remaining > 0) return;
    setBusy(true); setError(null);
    try {
      const result = correcting
        ? await startEmailChange({ newEmail: email.trim(), currentPassword: password })
        : await startEmailVerification({ uiLocale: locale });
      setChallenge({ id: "verificationId" in result ? result.verificationId : result.emailChangeId, expiresAt: result.expiresAt, change: correcting });
      setPassword(""); setCode(""); setNow(Date.now()); setCooldownUntil(Date.now() + 60_000);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "EMAIL_ALREADY_VERIFIED") {
        try { setUser((await getCurrentUser()).user); }
        catch (refreshError) { showError(refreshError); }
      } else showError(caught);
    } finally { setBusy(false); }
  }
  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (!challenge || busy || expired) return;
    setBusy(true); setError(null);
    try {
      const result = challenge.change ? await confirmEmailChange({ emailChangeId: challenge.id, code })
        : await confirmEmailVerification({ verificationId: challenge.id, code });
      setUser(result.user); setChallenge(null); setCode(""); router.refresh();
    } catch (caught) { showError(caught); }
    finally { setBusy(false); }
  }
  if (user.emailVerifiedAt) return <>
    <h1>{copy.success}</h1><p role="status">{user.email}</p>
    <Link className="primary-button auth-submit" href={localizeHref("/app")}>{copy.continue}</Link>
  </>;
  return <>
    <h1>{copy.title}</h1><p className="auth-intro">{copy.intro}</p>
    {challenge ? <form className="auth-form" onSubmit={confirm}>
      <p role="status">{copy.sent} <strong>{challenge.change ? email : user.email}</strong></p>
      <label className="field"><span>{copy.code}</span><input autoComplete="one-time-code" inputMode="numeric" maxLength={6} minLength={6} pattern="[0-9]{6}" required value={code} onChange={(event) => setCode(event.target.value)} aria-describedby="email-code-hint" /></label>
      <small id="email-code-hint">{copy.hint}</small>
      <p role={expired ? "alert" : undefined}>{expired ? copy.expired : copy.expiry.replace("{time}", new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(new Date(challenge.expiresAt)))}</p>
      <button className="primary-button" disabled={busy || expired} type="submit">{busy ? copy.verifying : copy.verify}</button>
      <button className="secondary-button" disabled={busy || remaining > 0} type="button" onClick={() => {
        if (challenge.change) { setChallenge(null); setError(null); } else void send();
      }}>{copy.resend}</button>
    </form> : <form className="auth-form" onSubmit={send}>
      <label className="field"><span>{copy.address}</span><input autoComplete="email" type="email" required maxLength={320} readOnly={!correcting} value={correcting ? email : user.email} onChange={(event) => setEmail(event.target.value)} /></label>
      {correcting ? <><p>{copy.changeHelp}</p><label className="field"><span>{copy.password}</span><input autoComplete="current-password" name="password" type="password" required maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} /></label></> : null}
      <button className="primary-button" disabled={busy || remaining > 0} type="submit">{busy ? copy.sending : copy.send}</button>
    </form>}
    {remaining > 0 ? <p>{copy.wait.replace("{seconds}", String(remaining))}</p> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <button className="text-button" disabled={busy} type="button" onClick={() => { setCorrecting(!correcting); setChallenge(null); setCode(""); setPassword(""); setError(null); }}>{correcting ? copy.cancel : copy.change}</button>
    <p><Link href={localizeHref("/app/account")}>{copy.account}</Link></p>
  </>;
}
