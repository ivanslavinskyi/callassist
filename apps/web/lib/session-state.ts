import type { User } from "@callassist/contracts";

export type SessionSnapshot =
  | { status: "authenticated"; user: { id: string; role: User["role"]; emailVerified: boolean } }
  | { status: "anonymous" | "loading" | "unavailable" };

export function sessionForUser(user: User | null): SessionSnapshot {
  return user ? {
    status: "authenticated",
    user: { id: user.id, role: user.role, emailVerified: Boolean(user.emailVerifiedAt) }
  } : { status: "anonymous" };
}

// One store per mounted shell, never a server-side or cross-request singleton.
export function createSessionStore(
  initial: SessionSnapshot,
  load: () => Promise<SessionSnapshot>
) {
  let snapshot = initial;
  let version = 0;
  let pending: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: SessionSnapshot) => {
    snapshot = next;
    listeners.forEach(listener => listener());
  };

  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => initial,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    refresh() {
      if (pending) return pending;
      const requestVersion = ++version;
      if (snapshot.status === "unavailable") publish({ status: "loading" });
      pending = Promise.resolve().then(load).catch((): SessionSnapshot => ({ status: "unavailable" }))
        .then(next => {
          if (requestVersion === version) publish(next);
        }).finally(() => {
          if (requestVersion === version) pending = null;
        });
      return pending;
    },
    endSession() {
      // A late /me response must not restore a session after logout or a 401.
      version++;
      pending = null;
      publish({ status: "anonymous" });
    }
  };
}
