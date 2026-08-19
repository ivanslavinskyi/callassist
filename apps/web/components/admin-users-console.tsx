"use client";

import type {
  AdminUserCreditLedger,
  AdminUserSummary,
  CreditTransaction,
  UserRole,
  UserStatus
} from "@callassist/contracts";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { AppShell } from "@/components/app-shell";
import { useUiLocale } from "@/components/ui-locale-provider";
import {
  getAdminUserCreditLedger,
  getCurrentUser,
  listAdminUsers
} from "@/lib/api";
import {
  adminUserMessages,
  getAdminUserErrorMessage
} from "@/lib/i18n/admin-user-messages";

type Access = "loading" | "allowed" | "forbidden";
type Filters = { search?: string; role?: UserRole; status?: UserStatus };

const roles: UserRole[] = [
  "user",
  "admin",
  "superadmin",
  "content_editor",
  "support"
];
const statuses: UserStatus[] = ["active", "suspended", "deleted"];

export function AdminUsersConsole() {
  const { locale, localizeHref } = useUiLocale();
  const copy = adminUserMessages[locale];
  const [access, setAccess] = useState<Access>("loading");
  const [canSeeStaff, setCanSeeStaff] = useState(false);
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({});
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [ledger, setLedger] = useState<AdminUserCreditLedger | null>(null);
  const [loadingLedgerId, setLoadingLedgerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ledgerError, setLedgerError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getCurrentUser()
      .then(async ({ user }) => {
        if (!active) return;
        if (!(["admin", "superadmin"] as UserRole[]).includes(user.role)) {
          setAccess("forbidden");
          return;
        }
        setCanSeeStaff(user.role === "superadmin");
        setAccess("allowed");
        setLoadingUsers(true);
        try {
          const result = await listAdminUsers({ limit: 20 });
          if (active) {
            setUsers(result.items);
            setNextCursor(result.nextCursor);
          }
        } catch (caught) {
          if (active) setError(getAdminUserErrorMessage(caught, locale));
        } finally {
          if (active) setLoadingUsers(false);
        }
      })
      .catch(() => { if (active) setAccess("forbidden"); });
    return () => { active = false; };
  }, [locale]);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const nextFilters: Filters = {
      ...(String(data.get("search") ?? "").trim()
        ? { search: String(data.get("search")).trim() }
        : {}),
      ...(String(data.get("role") ?? "")
        ? { role: String(data.get("role")) as UserRole }
        : {}),
      ...(String(data.get("status") ?? "")
        ? { status: String(data.get("status")) as UserStatus }
        : {})
    };
    setLoadingUsers(true);
    setError(null);
    setLedger(null);
    setLedgerError(null);
    try {
      const result = await listAdminUsers({ ...nextFilters, limit: 20 });
      setFilters(nextFilters);
      setUsers(result.items);
      setNextCursor(result.nextCursor);
    } catch (caught) {
      setError(getAdminUserErrorMessage(caught, locale));
    } finally {
      setLoadingUsers(false);
    }
  }

  async function loadMoreUsers() {
    if (!nextCursor) return;
    setLoadingMore(true);
    setError(null);
    try {
      const result = await listAdminUsers({
        ...filters,
        limit: 20,
        cursor: nextCursor
      });
      setUsers((current) => [...current, ...result.items]);
      setNextCursor(result.nextCursor);
    } catch (caught) {
      setError(getAdminUserErrorMessage(caught, locale));
    } finally {
      setLoadingMore(false);
    }
  }

  async function selectUser(userId: string) {
    setLoadingLedgerId(userId);
    setLedgerError(null);
    try {
      setLedger(await getAdminUserCreditLedger(userId));
    } catch (caught) {
      setLedger(null);
      setLedgerError(getAdminUserErrorMessage(caught, locale));
    } finally {
      setLoadingLedgerId(null);
    }
  }

  return (
    <AppShell>
      <main className="admin-users-page" id="main-content">
        <section className="admin-users-heading">
          <span className="eyebrow">{copy.eyebrow}</span>
          {access === "loading" ? (
            <p role="status">{copy.loadingAccess}</p>
          ) : access === "forbidden" ? (
            <div className="admin-access-card">
              <h1>{copy.forbiddenTitle}</h1>
              <p>{copy.forbidden}</p>
              <Link className="auth-inline-link" href={localizeHref("/login")}>{copy.signIn}</Link>
            </div>
          ) : (
            <>
              <h1>{copy.title}</h1>
              <p>{copy.intro}</p>
            </>
          )}
        </section>
        {access === "allowed" ? (
          <div className="admin-users-grid">
            <section className="admin-user-list-panel">
              <form className="admin-user-filters" onSubmit={search}>
                <label className="field admin-user-search">
                  <span>{copy.search}</span>
                  <input maxLength={100} name="search" placeholder={copy.searchPlaceholder} type="search" />
                </label>
                <label className="field">
                  <span>{copy.role}</span>
                  <select name="role">
                    <option value="">{copy.allRoles}</option>
                    {(canSeeStaff ? roles : ["user"] as UserRole[]).map((role) =>
                      <option key={role} value={role}>{copy.roles[role]}</option>
                    )}
                  </select>
                </label>
                <label className="field">
                  <span>{copy.status}</span>
                  <select name="status">
                    <option value="">{copy.allStatuses}</option>
                    {statuses.map((status) =>
                      <option key={status} value={status}>{copy.statuses[status]}</option>
                    )}
                  </select>
                </label>
                <button className="secondary-button" disabled={loadingUsers} type="submit">
                  {loadingUsers ? copy.applying : copy.apply}
                </button>
              </form>
              <div className="admin-user-list-heading">
                <strong>{copy.resultCount(users.length)}</strong>
              </div>
              {error ? <p className="form-error" role="alert">{error}</p> : null}
              {loadingUsers && users.length === 0 ? (
                <p className="admin-empty" role="status">{copy.loadingUsers}</p>
              ) : users.length === 0 ? (
                <p className="admin-empty">{copy.noUsers}</p>
              ) : (
                <ul className="admin-user-list">
                  {users.map((user) => (
                    <li key={user.id}>
                      <button
                        aria-pressed={ledger?.user.id === user.id}
                        className="admin-user-row"
                        onClick={() => void selectUser(user.id)}
                        type="button"
                      >
                        <span className="admin-user-identity">
                          <strong>{user.firstName} {user.lastName}</strong>
                          <small>{user.email}</small>
                        </span>
                        <span className="admin-user-badges">
                          <small>{copy.roles[user.role]}</small>
                          <small data-status={user.status}>{copy.statuses[user.status]}</small>
                          <small>{user.phoneVerified ? copy.verified : copy.unverified}</small>
                        </span>
                        <span className="admin-user-dates">
                          <small>{copy.created}: {formatDate(user.createdAt, locale)}</small>
                          <small>{copy.lastLogin}: {user.lastLoginAt ? formatDate(user.lastLoginAt, locale) : copy.never}</small>
                        </span>
                        <span className="admin-user-open">
                          {loadingLedgerId === user.id ? copy.loadingLedger : copy.viewLedger}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {nextCursor ? (
                <button className="secondary-button admin-load-more" disabled={loadingMore} onClick={() => void loadMoreUsers()} type="button">
                  {loadingMore ? copy.loadingMore : copy.loadMore}
                </button>
              ) : null}
            </section>
            <section className="admin-ledger-panel">
              {ledgerError ? <p className="form-error" role="alert">{ledgerError}</p> : null}
              {ledger ? <Ledger ledger={ledger} locale={locale} /> : (
                <div className="admin-ledger-empty">
                  <h2>{copy.selectTitle}</h2>
                  <p>{copy.selectHelp}</p>
                </div>
              )}
            </section>
          </div>
        ) : null}
      </main>
    </AppShell>
  );
}

function Ledger({ ledger, locale }: { ledger: AdminUserCreditLedger; locale: "en" | "de" }) {
  const copy = adminUserMessages[locale];
  return (
    <>
      <span className="eyebrow">{copy.ledger}</span>
      <h2>{ledger.user.firstName} {ledger.user.lastName}</h2>
      <p className="admin-ledger-email">{ledger.user.email}</p>
      <dl className="admin-ledger-summary">
        <div><dt>{copy.balance}</dt><dd>{ledger.usage.balance}</dd></div>
        <div><dt>{copy.activeCall}</dt><dd>{ledger.usage.activeCallBriefId ?? copy.noActiveCall}</dd></div>
      </dl>
      {ledger.usage.transactions.length === 0 ? (
        <p className="admin-empty">{copy.noTransactions}</p>
      ) : (
        <ol className="admin-ledger-list">
          {ledger.usage.transactions.map((transaction) => (
            <li key={transaction.id}>
              <div className="admin-ledger-transaction-heading">
                <strong>{copy.transactions[transaction.type]}</strong>
                <span data-positive={transaction.amount > 0}>
                  {transaction.amount > 0 ? "+" : ""}{transaction.amount}
                </span>
              </div>
              <time dateTime={transaction.createdAt}>{formatDateTime(transaction.createdAt, locale)}</time>
              {transaction.reason ? <p><b>{copy.reason}:</b> {transaction.reason}</p> : null}
              <TransactionSource transaction={transaction} locale={locale} />
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

function TransactionSource({ transaction, locale }: { transaction: CreditTransaction; locale: "en" | "de" }) {
  const copy = adminUserMessages[locale];
  const source = transaction.adminId
    ? `${copy.adminActor}: ${transaction.adminId}`
    : transaction.promoRedemptionId
      ? `${copy.promoRedemption}: ${transaction.promoRedemptionId}`
      : transaction.callAttemptId
        ? `${copy.callAttempt}: ${transaction.callAttemptId}`
        : null;
  return source ? <p className="admin-ledger-source"><b>{copy.source}:</b> {source}</p> : null;
}

function formatDate(value: string, locale: "en" | "de") {
  return new Intl.DateTimeFormat(locale === "de" ? "de-CH" : "en-GB", {
    dateStyle: "medium"
  }).format(new Date(value));
}

function formatDateTime(value: string, locale: "en" | "de") {
  return new Intl.DateTimeFormat(locale === "de" ? "de-CH" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
