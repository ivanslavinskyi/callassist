"use client";

import {
  ACCOUNT_DELETION_CONFIRMATION,
  type AccountDeletionRequest,
  AccountSessionList,
  AccountSessionSummary,
  CreditUsage,
  User
} from "@callassist/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AppShell } from "./app-shell";
import { ConfirmDialog } from "./confirm-dialog";
import { useUiLocale } from "./ui-locale-provider";
import {
  getAccountDeletion,
  getCreditUsage,
  getCurrentUser,
  listOwnSessions,
  logout,
  requestAccountDataExport,
  requestAccountDeletion,
  startPhoneChange,
  confirmPhoneChange,
  startEmailChange,
  confirmEmailChange,
  updateOwnName,
  revokeAllOwnSessions,
  revokeOwnSession
} from "@/lib/api";
import {
  accountMessages,
  getAccountContactChangeErrorMessage
} from "@/lib/i18n/account-messages";
import { normalizePhoneNumber } from "@/lib/phone-number";

type AccountData = {
  user: User;
  usage: CreditUsage;
  sessionInventory: AccountSessionList;
  deletion: AccountDeletionRequest | null;
};

export function AccountConsole() {
  const router = useRouter();
  const { locale, localizeHref } = useUiLocale();
  const copy = accountMessages[locale];
  const [data, setData] = useState<AccountData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [action, setAction] = useState<"logout" | "revoke-all" | string | null>(null);
  const [actionError, setActionError] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [selectedSession, setSelectedSession] = useState<AccountSessionSummary | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(false);
  const [deletionPassword, setDeletionPassword] = useState("");
  const [deletionConfirmation, setDeletionConfirmation] = useState("");
  const [deletionBusy, setDeletionBusy] = useState(false);
  const [deletionError, setDeletionError] = useState(false);
  const [phoneChangeId, setPhoneChangeId] = useState<string | null>(null);
  const [newPhoneE164, setNewPhoneE164] = useState("");
  const [phoneChangePassword, setPhoneChangePassword] = useState("");
  const [phoneChangeCode, setPhoneChangeCode] = useState("");
  const [phoneChangeBusy, setPhoneChangeBusy] = useState(false);
  const [phoneChangeError, setPhoneChangeError] = useState<string | null>(null);
  const [phoneChangeSuccess, setPhoneChangeSuccess] = useState(false);
  const [nameEditing, setNameEditing] = useState(false);
  const [profileFirstName, setProfileFirstName] = useState("");
  const [profileLastName, setProfileLastName] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState(false);
  const [emailChangeId, setEmailChangeId] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [emailChangePassword, setEmailChangePassword] = useState("");
  const [emailChangeCode, setEmailChangeCode] = useState("");
  const [emailChangeBusy, setEmailChangeBusy] = useState(false);
  const [emailChangeError, setEmailChangeError] = useState<string | null>(null);
  const [emailChangeSuccess, setEmailChangeSuccess] = useState(false);
  const [emailChangeOpen, setEmailChangeOpen] = useState(false);
  const [phoneChangeOpen, setPhoneChangeOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const [{ user }, usage, sessionInventory, deletionResponse] = await Promise.all([
        getCurrentUser(),
        getCreditUsage(),
        listOwnSessions(),
        getAccountDeletion()
      ]);
      setData({
        user,
        usage,
        sessionInventory,
        deletion: deletionResponse.request
      });
    } catch {
      setData(null);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!data?.deletion || data.deletion.status === "completed") return;
    const timer = window.setInterval(() => {
      void getAccountDeletion().then(({ request }) => {
        setData((current) => current ? { ...current, deletion: request } : current);
      }).catch(() => {
        router.replace(localizeHref("/"));
        router.refresh();
      });
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [data?.deletion, localizeHref, router]);

  async function endSession(mode: "logout" | "revoke-all") {
    setAction(mode);
    setActionError(false);
    try {
      if (mode === "revoke-all") await revokeAllOwnSessions();
      else await logout();
      router.replace(localizeHref("/"));
      router.refresh();
    } catch {
      setActionError(true);
      setAction(null);
      setConfirmRevoke(false);
    }
  }

  async function revokeSelectedSession() {
    if (!selectedSession) return;
    setAction(selectedSession.id);
    setActionError(false);
    try {
      await revokeOwnSession(selectedSession.id);
      if (selectedSession.current) {
        router.replace(localizeHref("/"));
        router.refresh();
        return;
      }
      setData((current) => current ? {
        ...current,
        sessionInventory: {
          ...current.sessionInventory,
          sessions: current.sessionInventory.sessions.filter(
            ({ id }) => id !== selectedSession.id
          ),
          totalActive: Math.max(0, current.sessionInventory.totalActive - 1)
        }
      } : current);
      setSelectedSession(null);
      setAction(null);
    } catch {
      setActionError(true);
      setSelectedSession(null);
      setAction(null);
    }
  }

  async function downloadDataExport() {
    setExporting(true);
    setExportError(false);
    try {
      const { blob, filename } = await requestAccountDataExport();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      setExportError(true);
    } finally {
      setExporting(false);
    }
  }

  async function startAccountDeletion() {
    setDeletionBusy(true);
    setDeletionError(false);
    try {
      const { request } = await requestAccountDeletion({
        requestId: crypto.randomUUID(),
        password: deletionPassword,
        confirmation: ACCOUNT_DELETION_CONFIRMATION
      });
      setData((current) => current ? { ...current, deletion: request } : current);
      setDeletionPassword("");
      setDeletionConfirmation("");
    } catch {
      setDeletionError(true);
    } finally {
      setDeletionBusy(false);
    }
  }

  async function beginPhoneChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPhoneChangeBusy(true);
    setPhoneChangeError(null);
    setPhoneChangeSuccess(false);
    try {
      const result = await startPhoneChange({
        newPhoneE164: normalizePhoneNumber(newPhoneE164),
        currentPassword: phoneChangePassword
      });
      setPhoneChangeId(result.phoneChangeId);
      setPhoneChangePassword("");
      setPhoneChangeCode("");
    } catch (error) {
      setPhoneChangeError(getAccountContactChangeErrorMessage(error, locale, "phone"));
    } finally {
      setPhoneChangeBusy(false);
    }
  }

  async function finishPhoneChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!phoneChangeId) return;
    setPhoneChangeBusy(true);
    setPhoneChangeError(null);
    try {
      const result = await confirmPhoneChange({
        phoneChangeId,
        code: phoneChangeCode.trim()
      });
      setData((current) => current ? {
        ...current,
        user: result.user,
        sessionInventory: {
          sessions: current.sessionInventory.sessions.filter(
            ({ current: isCurrent }) => isCurrent
          ),
          totalActive: 1,
          truncated: false
        }
      } : current);
      setNewPhoneE164("");
      setPhoneChangeCode("");
      setPhoneChangeId(null);
      setPhoneChangeSuccess(true);
      setPhoneChangeOpen(false);
    } catch (error) {
      setPhoneChangeError(getAccountContactChangeErrorMessage(error, locale, "phone"));
    } finally {
      setPhoneChangeBusy(false);
    }
  }

  function cancelPhoneChange() {
    setPhoneChangeId(null);
    setPhoneChangeCode("");
    setPhoneChangePassword("");
    setPhoneChangeError(null);
  }

  function closePhoneChange() {
    cancelPhoneChange();
    setNewPhoneE164("");
    setPhoneChangeOpen(false);
  }

  async function beginEmailChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEmailChangeBusy(true);
    setEmailChangeError(null);
    setEmailChangeSuccess(false);
    try {
      const result = await startEmailChange({
        newEmail: newEmail.trim(),
        currentPassword: emailChangePassword
      });
      setEmailChangeId(result.emailChangeId);
      setEmailChangePassword("");
      setEmailChangeCode("");
    } catch (error) {
      setEmailChangeError(getAccountContactChangeErrorMessage(error, locale, "email"));
    } finally {
      setEmailChangeBusy(false);
    }
  }

  async function finishEmailChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!emailChangeId) return;
    setEmailChangeBusy(true);
    setEmailChangeError(null);
    try {
      const result = await confirmEmailChange({
        emailChangeId,
        code: emailChangeCode.trim()
      });
      setData((current) => current ? {
        ...current,
        user: result.user,
        sessionInventory: {
          sessions: current.sessionInventory.sessions.filter(({ current: isCurrent }) => isCurrent),
          totalActive: 1,
          truncated: false
        }
      } : current);
      setEmailChangeId(null);
      setNewEmail("");
      setEmailChangeCode("");
      setEmailChangeSuccess(true);
      setEmailChangeOpen(false);
    } catch (error) {
      setEmailChangeError(getAccountContactChangeErrorMessage(error, locale, "email"));
    } finally {
      setEmailChangeBusy(false);
    }
  }

  function cancelEmailChange() {
    setEmailChangeId(null);
    setEmailChangeCode("");
    setEmailChangePassword("");
    setEmailChangeError(null);
  }

  function closeEmailChange() {
    cancelEmailChange();
    setNewEmail("");
    setEmailChangeOpen(false);
  }

  function openEmailChange() {
    closePhoneChange();
    setEmailChangeSuccess(false);
    setEmailChangeOpen(true);
  }

  function openPhoneChange() {
    closeEmailChange();
    setPhoneChangeSuccess(false);
    setPhoneChangeOpen(true);
  }

  function editName() {
    if (!data) return;
    setProfileFirstName(data.user.firstName);
    setProfileLastName(data.user.lastName);
    setProfileError(false);
    setProfileSuccess(false);
    setNameEditing(true);
  }

  function cancelNameEdit() {
    setNameEditing(false);
    setProfileError(false);
  }

  async function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileBusy(true);
    setProfileError(false);
    setProfileSuccess(false);
    try {
      const result = await updateOwnName({
        firstName: profileFirstName.trim(),
        lastName: profileLastName.trim()
      });
      setData((current) => current ? { ...current, user: result.user } : current);
      setNameEditing(false);
      setProfileSuccess(true);
    } catch {
      setProfileError(true);
    } finally {
      setProfileBusy(false);
    }
  }

  const dateFormatter = new Intl.DateTimeFormat(locale === "de" ? "de-CH" : "en-CH", {
    dateStyle: "medium",
    timeStyle: "short"
  });

  return (
    <AppShell>
      <main className="account-page" id="main-content" tabIndex={-1}>
        <header className="account-heading">
          <span className="eyebrow">{copy.eyebrow}</span>
          <h1>{copy.title}</h1>
          <p>{copy.intro}</p>
        </header>

        <nav aria-label={copy.sectionNavigation} className="account-section-nav">
          <a href="#profile">{copy.sectionProfile}</a>
          <a href="#usage">{copy.sectionUsage}</a>
          <a href="#data-privacy">{copy.sectionData}</a>
          <a href="#security">{copy.sectionSecurity}</a>
        </nav>

        {loading ? (
          <section className="account-card" role="status">{copy.loading}</section>
        ) : loadFailed || !data ? (
          <section className="account-card account-error" role="alert">
            <p>{copy.loadError}</p>
            <div className="account-actions">
              <button className="secondary-button" onClick={() => void load()} type="button">{copy.retry}</button>
              <Link className="primary-button compact-button" href={localizeHref("/login")}>{copy.signIn}</Link>
            </div>
          </section>
        ) : (
          <div className="account-grid">
            <section className="account-card" id="profile">
              <div className="account-card-heading">
                <h2>{copy.identityTitle}</h2>
                {!nameEditing ? (
                  <button className="text-button" onClick={editName} type="button">
                    {copy.nameEdit}
                  </button>
                ) : null}
              </div>
              {nameEditing ? (
                <form className="account-profile-form" onSubmit={saveName}>
                  <label>
                    <span>{copy.firstName}</span>
                    <input autoComplete="given-name" id="account-first-name" maxLength={80} name="firstName" onChange={(event) => setProfileFirstName(event.target.value)} required value={profileFirstName} />
                  </label>
                  <label>
                    <span>{copy.lastName}</span>
                    <input autoComplete="family-name" id="account-last-name" maxLength={80} name="lastName" onChange={(event) => setProfileLastName(event.target.value)} required value={profileLastName} />
                  </label>
                  <div className="account-actions">
                    <button className="primary-button compact-button" disabled={profileBusy} type="submit">{profileBusy ? copy.nameSaving : copy.nameSave}</button>
                    <button className="secondary-button" disabled={profileBusy} onClick={cancelNameEdit} type="button">{copy.nameCancel}</button>
                  </div>
                </form>
              ) : <dl className="account-details">
                <div><dt>{copy.name}</dt><dd>{data.user.firstName} {data.user.lastName}</dd></div>
                <div><dt>{copy.email}</dt><dd className="account-detail-action"><span>{data.user.email}</span><button aria-controls="account-email-change" aria-expanded={emailChangeOpen || Boolean(emailChangeId)} aria-label={copy.emailChangeActionLabel} className="text-button" onClick={openEmailChange} type="button">{copy.emailChangeAction}</button></dd></div>
                <div><dt>{copy.phone}</dt><dd className="account-detail-action"><span>{formatPhone(data.user.phoneE164)}</span><button aria-controls="account-phone-change" aria-expanded={phoneChangeOpen || Boolean(phoneChangeId)} aria-label={copy.phoneChangeActionLabel} className="text-button" onClick={openPhoneChange} type="button">{copy.phoneChangeAction}</button></dd></div>
                <div><dt>{copy.role}</dt><dd>{copy.roles[data.user.role]}</dd></div>
                <div><dt>{copy.status}</dt><dd>{copy.statuses[data.user.status]}</dd></div>
                <div>
                  <dt>{copy.lastLogin}</dt>
                  <dd>{data.user.lastLoginAt ? dateFormatter.format(new Date(data.user.lastLoginAt)) : copy.never}</dd>
                </div>
              </dl>}
              {profileError ? <p className="form-error" role="alert">{copy.nameError}</p> : null}
              {profileSuccess ? <p className="auth-success" role="status">{copy.nameSuccess}</p> : null}
              {emailChangeSuccess ? <p className="auth-success" role="status">{copy.emailChangeSuccess}</p> : null}
              {phoneChangeSuccess ? <p className="auth-success" role="status">{copy.phoneChangeSuccess}</p> : null}
            </section>

            {emailChangeOpen || emailChangeId ? <section className="account-card account-email-change" id="account-email-change">
              <h2>{copy.emailChangeTitle}</h2>
              <p>{copy.emailChangeText}</p>
              {emailChangeId ? (
                <form onSubmit={finishEmailChange}>
                  <p className="account-change-destination">
                    {copy.emailChangeSent} <strong>{maskEmail(newEmail)}</strong>
                  </p>
                  <div className="account-contact-change-fields">
                    <label>
                      <span>{copy.emailChangeCode}</span>
                      <input aria-describedby={emailChangeError ? "email-change-code-hint email-change-error" : "email-change-code-hint"} aria-invalid={emailChangeError ? true : undefined} autoComplete="one-time-code" id="email-change-code" inputMode="numeric" maxLength={6} minLength={6} name="code" onChange={(event) => setEmailChangeCode(event.target.value)} pattern="[0-9]{6}" required type="text" value={emailChangeCode} />
                      <small id="email-change-code-hint">{copy.emailChangeCodeHint}</small>
                    </label>
                  </div>
                  <div className="account-actions">
                    <button className="primary-button compact-button" disabled={emailChangeBusy} type="submit">{emailChangeBusy ? copy.emailChangeVerifying : copy.emailChangeVerify}</button>
                    <button className="secondary-button" disabled={emailChangeBusy} onClick={cancelEmailChange} type="button">{copy.emailChangeCancel}</button>
                  </div>
                </form>
              ) : (
                <form autoComplete="on" name="change-email" onSubmit={beginEmailChange}>
                  <div className="account-contact-change-fields">
                    <label className="account-current-account">
                      <span>{copy.currentAccount}</span>
                      <input autoComplete="username" id="change-email-username" name="username" readOnly type="email" value={data.user.email} />
                    </label>
                    <label>
                      <span>{copy.emailChangeNewEmail}</span>
                      <input aria-describedby={emailChangeError ? "email-change-error" : undefined} aria-invalid={emailChangeError ? true : undefined} autoComplete="email" id="new-email" maxLength={320} name="newEmail" onChange={(event) => setNewEmail(event.target.value)} required type="email" value={newEmail} />
                    </label>
                    <label>
                      <span>{copy.emailChangeCurrentPassword}</span>
                      <input aria-describedby={emailChangeError ? "email-change-error" : undefined} aria-invalid={emailChangeError ? true : undefined} autoComplete="current-password" id="change-email-current-password" maxLength={128} name="currentPassword" onChange={(event) => setEmailChangePassword(event.target.value)} required type="password" value={emailChangePassword} />
                    </label>
                  </div>
                  <div className="account-actions">
                    <button className="primary-button compact-button" disabled={emailChangeBusy} type="submit">{emailChangeBusy ? copy.emailChangeSending : copy.emailChangeSend}</button>
                    <button className="secondary-button" disabled={emailChangeBusy} onClick={closeEmailChange} type="button">{copy.emailChangeClose}</button>
                  </div>
                </form>
              )}
              {emailChangeError ? <p className="form-error" id="email-change-error" role="alert">{emailChangeError}</p> : null}
            </section> : null}

            {phoneChangeOpen || phoneChangeId ? <section className="account-card account-phone-change" id="account-phone-change">
              <h2>{copy.phoneChangeTitle}</h2>
              <p>{copy.phoneChangeText}</p>
              <p className="account-muted">{copy.phoneChangeSecurity}</p>
              {phoneChangeId ? (
                <form onSubmit={finishPhoneChange}>
                  <p className="account-change-destination">
                    {copy.phoneChangeSent} <strong>{maskPhone(normalizePhoneNumber(newPhoneE164))}</strong>
                  </p>
                  <div className="account-phone-change-fields">
                    <label>
                      <span>{copy.phoneChangeCode}</span>
                      <input
                        aria-describedby={phoneChangeError ? "phone-change-code-hint phone-change-error" : "phone-change-code-hint"}
                        aria-invalid={phoneChangeError ? true : undefined}
                        autoComplete="one-time-code"
                        id="phone-change-code"
                        inputMode="numeric"
                        maxLength={10}
                        minLength={4}
                        name="code"
                        onChange={(event) => setPhoneChangeCode(event.target.value)}
                        pattern="[0-9]{4,10}"
                        required
                        type="text"
                        value={phoneChangeCode}
                      />
                      <small id="phone-change-code-hint">{copy.phoneChangeCodeHint}</small>
                    </label>
                  </div>
                  <div className="account-actions">
                    <button className="primary-button compact-button" disabled={phoneChangeBusy} type="submit">
                      {phoneChangeBusy ? copy.phoneChangeVerifying : copy.phoneChangeVerify}
                    </button>
                    <button className="secondary-button" disabled={phoneChangeBusy} onClick={cancelPhoneChange} type="button">
                      {copy.phoneChangeCancel}
                    </button>
                  </div>
                </form>
              ) : (
                <form autoComplete="on" name="change-mobile" onSubmit={beginPhoneChange}>
                  <div className="account-phone-change-fields">
                    <label className="account-current-account">
                      <span>{copy.currentAccount}</span>
                      <input autoComplete="username" id="change-mobile-username" name="username" readOnly type="email" value={data.user.email} />
                    </label>
                    <label>
                      <span>{copy.phoneChangeNewPhone}</span>
                      <input
                        aria-describedby={phoneChangeError ? "new-mobile-hint phone-change-error" : "new-mobile-hint"}
                        aria-invalid={phoneChangeError ? true : undefined}
                        autoComplete="tel"
                        id="new-mobile"
                        inputMode="tel"
                        maxLength={40}
                        name="newPhoneE164"
                        onChange={(event) => setNewPhoneE164(event.target.value)}
                        placeholder="079 123 45 67"
                        required
                        type="tel"
                        value={newPhoneE164}
                      />
                      <small id="new-mobile-hint">{copy.phoneChangeFormatHint}</small>
                    </label>
                    <label>
                      <span>{copy.phoneChangeCurrentPassword}</span>
                      <input
                        aria-describedby={phoneChangeError ? "phone-change-error" : undefined}
                        aria-invalid={phoneChangeError ? true : undefined}
                        autoComplete="current-password"
                        id="change-mobile-current-password"
                        maxLength={128}
                        name="currentPassword"
                        onChange={(event) => setPhoneChangePassword(event.target.value)}
                        required
                        type="password"
                        value={phoneChangePassword}
                      />
                    </label>
                  </div>
                  <div className="account-actions">
                    <button className="primary-button compact-button" disabled={phoneChangeBusy} type="submit">
                      {phoneChangeBusy ? copy.phoneChangeSending : copy.phoneChangeSend}
                    </button>
                    <button className="secondary-button" disabled={phoneChangeBusy} onClick={closePhoneChange} type="button">{copy.phoneChangeClose}</button>
                  </div>
                </form>
              )}
              {phoneChangeError ? (
                <p className="form-error" id="phone-change-error" role="alert">{phoneChangeError}</p>
              ) : null}
            </section> : null}

            <section className="account-card account-usage" id="usage">
              <h2>{copy.usageTitle}</h2>
              <dl className="account-usage-summary">
                <div><dt>{copy.balance}</dt><dd>{copy.credits(data.usage.balance)}</dd></div>
                <div><dt>{copy.activeCall}</dt><dd>{data.usage.activeCallBriefId ?? copy.noActiveCall}</dd></div>
              </dl>
              <h3>{copy.transactions}</h3>
              {data.usage.transactions.length ? (
                <ul className="account-transactions">
                  {data.usage.transactions.map((transaction) => (
                    <li key={transaction.id}>
                      <div>
                        <strong>{copy.transaction[transaction.type]}</strong>
                        <time dateTime={transaction.createdAt}>{dateFormatter.format(new Date(transaction.createdAt))}</time>
                      </div>
                      <span data-positive={transaction.amount > 0}>{transaction.amount > 0 ? "+" : ""}{transaction.amount}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="account-muted">{copy.noTransactions}</p>}
            </section>

            <section className="account-card account-export" id="data-privacy">
              <h2>{copy.exportTitle}</h2>
              <p>{copy.exportText}</p>
              <ul>
                {copy.exportIncludes.map((item) => <li key={item}>{item}</li>)}
              </ul>
              <p className="account-muted">{copy.exportPrivacy}</p>
              <div className="account-actions">
                <button
                  className="primary-button"
                  disabled={exporting}
                  onClick={() => void downloadDataExport()}
                  type="button"
                >
                  {exporting ? copy.exportBusy : copy.exportAction}
                </button>
              </div>
              {exportError ? <p className="form-error" role="alert">{copy.exportError}</p> : null}
            </section>

            <section className="account-card account-deletion">
              <h2>{copy.deletionTitle}</h2>
              <p>{copy.deletionText}</p>
              <p className="account-deletion-warning">{copy.deletionIrreversible}</p>
              {data.deletion ? (
                <div className="account-deletion-status" role="status" aria-live="polite">
                  <span>{copy.deletionStatusTitle}</span>
                  <strong data-status={data.deletion.status}>
                    {copy.deletionStatuses[data.deletion.status]}
                  </strong>
                  <small>{copy.deletionAttempt(
                    data.deletion.attemptCount,
                    data.deletion.maxAttempts
                  )}</small>
                  {data.deletion.status === "retrying" ? (
                    <p>{copy.deletionNextAttempt}</p>
                  ) : null}
                  {data.deletion.status === "needs_support" ? (
                    <p>{copy.deletionNeedsSupport}</p>
                  ) : null}
                </div>
              ) : (
                <form onSubmit={(event) => {
                  event.preventDefault();
                  void startAccountDeletion();
                }}>
                  <p className="account-muted">{copy.deletionExportFirst}</p>
                  <div className="account-deletion-fields">
                    <label>
                      <span>{copy.deletionPassword}</span>
                      <input
                        autoComplete="current-password"
                        disabled={deletionBusy}
                        maxLength={128}
                        onChange={(event) => setDeletionPassword(event.target.value)}
                        required
                        type="password"
                        value={deletionPassword}
                      />
                    </label>
                    <label>
                      <span>{copy.deletionConfirmation}</span>
                      <input
                        autoComplete="off"
                        disabled={deletionBusy}
                        onChange={(event) => setDeletionConfirmation(event.target.value)}
                        required
                        type="text"
                        value={deletionConfirmation}
                      />
                      <small>{copy.deletionConfirmationHint}</small>
                    </label>
                  </div>
                  <button
                    className="danger-button"
                    disabled={
                      deletionBusy ||
                      deletionConfirmation !== ACCOUNT_DELETION_CONFIRMATION ||
                      deletionPassword.length === 0
                    }
                    type="submit"
                  >
                    {deletionBusy ? copy.deletionBusy : copy.deletionAction}
                  </button>
                  {deletionError ? (
                    <p className="form-error" role="alert">{copy.deletionError}</p>
                  ) : null}
                </form>
              )}
            </section>

            <section className="account-card account-sessions" id="security">
              <h2>{copy.sessionsTitle}</h2>
              <p>{copy.sessionsText}</p>
              <div className="account-session-heading">
                <h3>{copy.activeSessions}</h3>
                <span>{copy.sessionCount(data.sessionInventory.totalActive)}</span>
              </div>
              {data.sessionInventory.sessions.length ? (
                <ul className="account-session-list">
                  {data.sessionInventory.sessions.map((session) => (
                    <li key={session.id}>
                      <div className="account-session-title">
                        <strong>{copy.browser[session.browser]} · {copy.platform[session.platform]}</strong>
                        {session.current ? <span>{copy.currentSession}</span> : null}
                      </div>
                      <dl>
                        <div><dt>{copy.lastSeen}</dt><dd><time dateTime={session.lastSeenAt}>{dateFormatter.format(new Date(session.lastSeenAt))}</time></dd></div>
                        <div><dt>{copy.created}</dt><dd><time dateTime={session.createdAt}>{dateFormatter.format(new Date(session.createdAt))}</time></dd></div>
                        <div><dt>{copy.expires}</dt><dd><time dateTime={session.expiresAt}>{dateFormatter.format(new Date(session.expiresAt))}</time></dd></div>
                      </dl>
                      <button
                        className="danger-button compact-button"
                        disabled={action !== null}
                        onClick={() => setSelectedSession(session)}
                        type="button"
                      >
                        {action === session.id
                          ? (session.current ? copy.logoutBusy : copy.revokeSessionBusy)
                          : (session.current ? copy.logout : copy.revokeSession)}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : <p className="account-muted">{copy.noSessions}</p>}
              {data.sessionInventory.truncated ? (
                <p className="account-muted">{copy.sessionsTruncated}</p>
              ) : null}
              <div className="account-actions">
                <button className="danger-button" disabled={action !== null} onClick={() => setConfirmRevoke(true)} type="button">
                  {action === "revoke-all" ? copy.revokeBusy : copy.revokeAll}
                </button>
              </div>
              {actionError ? <p className="form-error" role="alert">{copy.actionError}</p> : null}
            </section>
          </div>
        )}
      </main>
      <ConfirmDialog
        busy={action === "revoke-all"}
        confirmLabel={action === "revoke-all" ? copy.revokeBusy : copy.revokeAll}
        danger
        description={copy.revokeDescription}
        onCancel={() => setConfirmRevoke(false)}
        onConfirm={() => void endSession("revoke-all")}
        open={confirmRevoke}
        title={copy.revokeTitle}
      />
      <ConfirmDialog
        busy={selectedSession ? action === selectedSession.id : false}
        confirmLabel={selectedSession && action === selectedSession.id
          ? copy.revokeSessionBusy
          : copy.revokeSession}
        danger
        description={copy.revokeSessionDescription(selectedSession?.current ?? false)}
        onCancel={() => setSelectedSession(null)}
        onConfirm={() => void revokeSelectedSession()}
        open={selectedSession !== null}
        title={copy.revokeSessionTitle}
      />
    </AppShell>
  );
}

function maskEmail(email: string) {
  const [local = "", domain = ""] = email.split("@");
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"•".repeat(Math.max(3, Math.min(8, local.length - visible.length)))}@${domain}`;
}

function formatPhone(phone: string) {
  const swiss = /^\+41(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(phone);
  return swiss ? `+41 ${swiss[1]} ${swiss[2]} ${swiss[3]} ${swiss[4]}` : phone;
}

function maskPhone(phone: string) {
  if (phone.length < 6) return phone;
  return `${phone.slice(0, 3)} •• ••• ${phone.slice(-4, -2)} ${phone.slice(-2)}`;
}
