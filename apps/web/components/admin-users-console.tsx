"use client";

import type {
  AccountDeletionRequest,
  AdminUserCreditLedger,
  AdminUserSummary,
  CreditTransaction,
  CreditUsage,
  UserRole,
  UserStatus
} from "@callassist/contracts";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AppShell } from "@/components/app-shell";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useUiLocale } from "@/components/ui-locale-provider";
import {
  changeAdminUserStatus,
  getAdminUserCreditLedger,
  getCurrentUser,
  grantCreditsAsAdmin,
  listAdminUsers,
  retryAdminAccountDeletion,
  revokeAdminUserSessions
} from "@/lib/api";
import {
  adminUserMessages,
  getAdminUserErrorMessage
} from "@/lib/i18n/admin-user-messages";
import { getCreditErrorMessage } from "@/lib/i18n/credit-messages";

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
  const [actorId, setActorId] = useState<string | null>(null);
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
        setActorId(user.id);
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

  function updateSelectedUserStatus(userId: string, status: UserStatus) {
    setUsers((current) => current.map((user) =>
      user.id === userId ? { ...user, status } : user
    ));
    setLedger((current) => current?.user.id === userId
      ? { ...current, user: { ...current.user, status } }
      : current
    );
  }

  function updateSelectedUsage(userId: string, usage: CreditUsage) {
    setLedger((current) => current?.user.id === userId
      ? { ...current, usage }
      : current
    );
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
              {ledger ? (
                <Ledger
                  actorId={actorId}
                  ledger={ledger}
                  locale={locale}
                  onStatusChange={updateSelectedUserStatus}
                  onUsageChange={updateSelectedUsage}
                />
              ) : (
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

function Ledger({
  actorId,
  ledger,
  locale,
  onStatusChange,
  onUsageChange
}: {
  actorId: string | null;
  ledger: AdminUserCreditLedger;
  locale: "en" | "de";
  onStatusChange: (userId: string, status: UserStatus) => void;
  onUsageChange: (userId: string, usage: CreditUsage) => void;
}) {
  const copy = adminUserMessages[locale];
  return (
    <>
      <span className="eyebrow">{copy.ledger}</span>
      <h2>{ledger.user.firstName} {ledger.user.lastName}</h2>
      <p className="admin-ledger-email">{ledger.user.email}</p>
      <dl className="admin-ledger-summary">
        <div><dt>{copy.balance}</dt><dd>{ledger.usage.balance}</dd></div>
        <div><dt>{copy.activeCall}</dt><dd>{ledger.usage.activeCallBriefId ?? copy.noActiveCall}</dd></div>
        <div><dt>{copy.status}</dt><dd data-status={ledger.user.status}>{copy.statuses[ledger.user.status]}</dd></div>
        <div><dt>{copy.phoneVerification}</dt><dd>{ledger.user.phoneVerified ? copy.verified : copy.unverified}</dd></div>
        <div>
          <dt>{copy.accountDeletion}</dt>
          <dd>{ledger.accountDeletion
            ? copy.deletionStatuses[ledger.accountDeletion.status]
            : copy.noAccountDeletion}</dd>
        </div>
      </dl>
      <AdminUserActions
        actorId={actorId}
        key={ledger.user.id}
        locale={locale}
        onStatusChange={onStatusChange}
        onUsageChange={onUsageChange}
        user={ledger.user}
      />
      {ledger.accountDeletion?.status === "needs_support" ? (
        <AccountDeletionRecovery
          deletion={ledger.accountDeletion}
          locale={locale}
          userId={ledger.user.id}
        />
      ) : null}
      <h3 className="admin-ledger-history-title">{copy.transactionHistory}</h3>
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

type PendingAction =
  | { kind: "status"; reason: string; status: "active" | "suspended" }
  | { kind: "sessions"; reason: string }
  | { kind: "grant"; credits: number; reason: string };

function AdminUserActions({
  actorId,
  locale,
  onStatusChange,
  onUsageChange,
  user
}: {
  actorId: string | null;
  locale: "en" | "de";
  onStatusChange: (userId: string, status: UserStatus) => void;
  onUsageChange: (userId: string, usage: CreditUsage) => void;
  user: AdminUserSummary;
}) {
  const copy = adminUserMessages[locale];
  const [busy, setBusy] = useState<PendingAction["kind"] | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [statusReason, setStatusReason] = useState("");
  const [sessionReason, setSessionReason] = useState("");
  const [grantCredits, setGrantCredits] = useState("1");
  const [grantReason, setGrantReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const grantKey = useRef<string | null>(null);
  const displayName = `${user.firstName} ${user.lastName}`;
  const isSelf = actorId === user.id;
  const isDeleted = user.status === "deleted";
  const canGrant = !isSelf && user.status === "active" && user.phoneVerified;
  const nextStatus = user.status === "active" ? "suspended" : "active";

  function prepareStatusChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending({ kind: "status", status: nextStatus, reason: statusReason.trim() });
  }

  function prepareSessionRevocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending({ kind: "sessions", reason: sessionReason.trim() });
  }

  function prepareGrant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending({
      kind: "grant",
      credits: Number(grantCredits),
      reason: grantReason.trim()
    });
  }

  async function confirmAction() {
    if (!pending) return;
    setBusy(pending.kind);
    setError(null);
    setNotice(null);
    try {
      if (pending.kind === "status") {
        const result = await changeAdminUserStatus(user.id, {
          status: pending.status,
          reason: pending.reason
        });
        onStatusChange(user.id, result.user.status);
        setStatusReason("");
        setNotice(copy.statusSuccess(displayName, copy.statuses[result.user.status]));
      } else if (pending.kind === "sessions") {
        await revokeAdminUserSessions(user.id, { reason: pending.reason });
        setSessionReason("");
        setNotice(copy.logoutSuccess(displayName));
      } else {
        grantKey.current ??= crypto.randomUUID();
        const result = await grantCreditsAsAdmin({
          targetEmail: user.email,
          credits: pending.credits,
          reason: pending.reason,
          idempotencyKey: grantKey.current
        });
        onUsageChange(user.id, result.usage);
        setGrantCredits("1");
        setGrantReason("");
        grantKey.current = null;
        setNotice(copy.grantSuccess(pending.credits, displayName));
      }
    } catch (caught) {
      setError(pending.kind === "grant"
        ? getCreditErrorMessage(caught, locale)
        : getAdminUserErrorMessage(caught, locale)
      );
    } finally {
      setBusy(null);
      setPending(null);
    }
  }

  const dialog = pending ? getDialogCopy(pending, displayName, copy) : null;

  return (
    <section className="admin-user-actions">
      <div className="admin-user-actions-heading">
        <h3>{copy.actionsTitle}</h3>
        <p>{copy.actionsHelp}</p>
      </div>
      {isSelf ? (
        <p className="admin-action-unavailable">{copy.selfActionsUnavailable}</p>
      ) : isDeleted ? (
        <p className="admin-action-unavailable">{copy.deletedActionsUnavailable}</p>
      ) : (
        <div className="admin-action-list">
          <form
            aria-label={user.status === "active" ? copy.suspendTitle : copy.unsuspendTitle}
            className="admin-action-card"
            onSubmit={prepareStatusChange}
          >
            <div>
              <h4>{user.status === "active" ? copy.suspendTitle : copy.unsuspendTitle}</h4>
              <p>{user.status === "active" ? copy.suspendHelp : copy.unsuspendHelp}</p>
            </div>
            <ReasonField
              label={copy.operationalReason}
              onChange={setStatusReason}
              placeholder={copy.statusReasonPlaceholder}
              value={statusReason}
            />
            <button
              className={user.status === "active" ? "danger-button" : "secondary-button"}
              disabled={busy !== null}
              type="submit"
            >
              {busy === "status"
                ? (user.status === "active" ? copy.suspending : copy.unsuspending)
                : (user.status === "active" ? copy.suspend : copy.unsuspend)}
            </button>
          </form>
          <form aria-label={copy.logoutTitle} className="admin-action-card" onSubmit={prepareSessionRevocation}>
            <div>
              <h4>{copy.logoutTitle}</h4>
              <p>{copy.logoutHelp}</p>
            </div>
            <ReasonField
              label={copy.operationalReason}
              onChange={setSessionReason}
              placeholder={copy.logoutReasonPlaceholder}
              value={sessionReason}
            />
            <button className="danger-button" disabled={busy !== null} type="submit">
              {busy === "sessions" ? copy.loggingOut : copy.forceLogout}
            </button>
          </form>
          <form
            aria-label={copy.grantTitle}
            className="admin-action-card"
            onChange={() => { grantKey.current = null; }}
            onSubmit={prepareGrant}
          >
            <div>
              <h4>{copy.grantTitle}</h4>
              <p>{canGrant ? copy.grantHelp : copy.grantUnavailable}</p>
            </div>
            <label className="field">
              <span>{copy.credits}</span>
              <input
                disabled={!canGrant || busy !== null}
                max={100}
                min={1}
                onChange={(event) => setGrantCredits(event.target.value)}
                required
                type="number"
                value={grantCredits}
              />
            </label>
            <ReasonField
              disabled={!canGrant || busy !== null}
              label={copy.operationalReason}
              onChange={setGrantReason}
              placeholder={copy.grantReasonPlaceholder}
              value={grantReason}
            />
            <button className="secondary-button" disabled={!canGrant || busy !== null} type="submit">
              {busy === "grant" ? copy.granting : copy.grant}
            </button>
          </form>
        </div>
      )}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {notice ? <p className="auth-success" role="status">{notice}</p> : null}
      <ConfirmDialog
        busy={busy !== null}
        confirmLabel={dialog?.confirmLabel ?? ""}
        danger={dialog?.danger}
        description={dialog?.description ?? ""}
        onCancel={() => setPending(null)}
        onConfirm={() => void confirmAction()}
        open={pending !== null}
        title={dialog?.title ?? ""}
      />
    </section>
  );
}

function AccountDeletionRecovery({
  deletion,
  locale,
  userId
}: {
  deletion: AccountDeletionRequest;
  locale: "en" | "de";
  userId: string;
}) {
  const copy = adminUserMessages[locale];
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);

  async function retryDeletion() {
    setBusy(true);
    setError(null);
    try {
      await retryAdminAccountDeletion(userId, deletion.requestId, {
        reason: reason.trim()
      });
      setCompleted(true);
      setReason("");
    } catch (caught) {
      setError(getAdminUserErrorMessage(caught, locale));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  if (completed) {
    return <p className="auth-success" role="status">{copy.deletionRecoverySuccess}</p>;
  }

  return (
    <section className="admin-user-actions">
      <div className="admin-user-actions-heading">
        <h3>{copy.deletionRecoveryTitle}</h3>
        <p>{copy.deletionRecoveryHelp}</p>
      </div>
      <form className="admin-action-card" onSubmit={(event) => {
        event.preventDefault();
        setConfirming(true);
      }}>
        <ReasonField
          label={copy.operationalReason}
          onChange={setReason}
          placeholder={copy.deletionRecoveryReasonPlaceholder}
          value={reason}
        />
        <button className="danger-button" disabled={busy} type="submit">
          {busy ? copy.deletionRecoveryBusy : copy.deletionRecoveryAction}
        </button>
      </form>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <ConfirmDialog
        busy={busy}
        confirmLabel={busy ? copy.deletionRecoveryBusy : copy.deletionRecoveryAction}
        danger
        description={copy.deletionRecoveryConfirmDescription}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void retryDeletion()}
        open={confirming}
        title={copy.deletionRecoveryConfirmTitle}
      />
    </section>
  );
}

function ReasonField({
  disabled = false,
  label,
  onChange,
  placeholder,
  value
}: {
  disabled?: boolean;
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <textarea
        disabled={disabled}
        maxLength={500}
        minLength={3}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required
        rows={3}
        value={value}
      />
    </label>
  );
}

function getDialogCopy(
  action: PendingAction,
  displayName: string,
  copy: (typeof adminUserMessages)["en"]
) {
  if (action.kind === "status") {
    const suspending = action.status === "suspended";
    return {
      title: suspending ? copy.confirmSuspendTitle : copy.confirmUnsuspendTitle,
      description: copy.statusConfirmDescription(displayName, action.status),
      confirmLabel: suspending ? copy.suspend : copy.unsuspend,
      danger: suspending
    };
  }
  if (action.kind === "sessions") {
    return {
      title: copy.confirmLogoutTitle,
      description: copy.logoutConfirmDescription(displayName),
      confirmLabel: copy.forceLogout,
      danger: true
    };
  }
  return {
    title: copy.confirmGrantTitle,
    description: copy.grantConfirmDescription(action.credits, displayName),
    confirmLabel: copy.grant,
    danger: false
  };
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
