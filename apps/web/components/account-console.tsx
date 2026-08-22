"use client";

import type {
  AccountSessionList,
  AccountSessionSummary,
  CreditUsage,
  User
} from "@callassist/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "./app-shell";
import { ConfirmDialog } from "./confirm-dialog";
import { useUiLocale } from "./ui-locale-provider";
import {
  getCreditUsage,
  getCurrentUser,
  listOwnSessions,
  logout,
  revokeAllOwnSessions,
  revokeOwnSession
} from "@/lib/api";
import { accountMessages } from "@/lib/i18n/account-messages";

type AccountData = {
  user: User;
  usage: CreditUsage;
  sessionInventory: AccountSessionList;
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

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const [{ user }, usage, sessionInventory] = await Promise.all([
        getCurrentUser(),
        getCreditUsage(),
        listOwnSessions()
      ]);
      setData({ user, usage, sessionInventory });
    } catch {
      setData(null);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

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
