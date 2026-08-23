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
  revokeAllOwnSessions,
  revokeOwnSession
} from "@/lib/api";
import { accountMessages } from "@/lib/i18n/account-messages";

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
  const [phoneChangeError, setPhoneChangeError] = useState(false);
  const [phoneChangeSuccess, setPhoneChangeSuccess] = useState(false);

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
    setPhoneChangeError(false);
    setPhoneChangeSuccess(false);
    try {
      const result = await startPhoneChange({
        newPhoneE164: newPhoneE164.trim(),
        currentPassword: phoneChangePassword
      });
      setPhoneChangeId(result.phoneChangeId);
      setPhoneChangePassword("");
      setPhoneChangeCode("");
    } catch {
      setPhoneChangeError(true);
    } finally {
      setPhoneChangeBusy(false);
    }
  }

  async function finishPhoneChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!phoneChangeId) return;
    setPhoneChangeBusy(true);
    setPhoneChangeError(false);
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
    } catch {
      setPhoneChangeError(true);
    } finally {
      setPhoneChangeBusy(false);
    }
  }

  function cancelPhoneChange() {
    setPhoneChangeId(null);
    setPhoneChangeCode("");
    setPhoneChangePassword("");
    setPhoneChangeError(false);
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
            <section className="account-card">
              <h2>{copy.identityTitle}</h2>
              <dl className="account-details">
                <div><dt>{copy.name}</dt><dd>{data.user.firstName} {data.user.lastName}</dd></div>
                <div><dt>{copy.email}</dt><dd>{data.user.email}</dd></div>
                <div><dt>{copy.phone}</dt><dd>{data.user.phoneE164}</dd></div>
                <div><dt>{copy.role}</dt><dd>{data.user.role}</dd></div>
                <div><dt>{copy.status}</dt><dd>{data.user.status}</dd></div>
                <div>
                  <dt>{copy.lastLogin}</dt>
                  <dd>{data.user.lastLoginAt ? dateFormatter.format(new Date(data.user.lastLoginAt)) : copy.never}</dd>
                </div>
              </dl>
            </section>

            <section className="account-card account-phone-change">
              <h2>{copy.phoneChangeTitle}</h2>
              <p>{copy.phoneChangeText}</p>
              <p className="account-muted">{copy.phoneChangeSecurity}</p>
              {phoneChangeId ? (
                <form onSubmit={finishPhoneChange}>
                  <div className="account-phone-change-fields">
                    <label>
                      <span>{copy.phoneChangeCode}</span>
                      <input
                        autoComplete="one-time-code"
                        inputMode="numeric"
                        onChange={(event) => setPhoneChangeCode(event.target.value)}
                        pattern="[0-9]{4,10}"
                        required
                        type="text"
                        value={phoneChangeCode}
                      />
                      <small>{copy.phoneChangeCodeHint}</small>
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
                <form onSubmit={beginPhoneChange}>
                  <div className="account-phone-change-fields">
                    <label>
                      <span>{copy.phoneChangeNewPhone}</span>
                      <input
                        autoComplete="tel"
                        inputMode="tel"
                        onChange={(event) => setNewPhoneE164(event.target.value)}
                        pattern="\+[1-9][0-9]{7,14}"
                        placeholder="+41…"
                        required
                        type="tel"
                        value={newPhoneE164}
                      />
                    </label>
                    <label>
                      <span>{copy.phoneChangeCurrentPassword}</span>
                      <input
                        autoComplete="current-password"
                        maxLength={128}
                        onChange={(event) => setPhoneChangePassword(event.target.value)}
                        required
                        type="password"
                        value={phoneChangePassword}
                      />
                    </label>
                  </div>
                  <button className="primary-button compact-button" disabled={phoneChangeBusy} type="submit">
                    {phoneChangeBusy ? copy.phoneChangeSending : copy.phoneChangeSend}
                  </button>
                </form>
              )}
              {phoneChangeError ? (
                <p className="form-error" role="alert">{copy.phoneChangeError}</p>
              ) : null}
              {phoneChangeSuccess ? (
                <p className="auth-success" role="status">{copy.phoneChangeSuccess}</p>
              ) : null}
            </section>

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

            <section className="account-card account-export">
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

            <section className="account-card account-sessions">
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
                        {action === session.id ? copy.revokeSessionBusy : copy.revokeSession}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : <p className="account-muted">{copy.noSessions}</p>}
              {data.sessionInventory.truncated ? (
                <p className="account-muted">{copy.sessionsTruncated}</p>
              ) : null}
              <div className="account-actions">
                <button className="secondary-button" disabled={action !== null} onClick={() => void endSession("logout")} type="button">
                  {action === "logout" ? copy.logoutBusy : copy.logout}
                </button>
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
