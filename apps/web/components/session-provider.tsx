"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ApiError, getCurrentUser } from "@/lib/api";
import { createSessionStore, sessionForUser, type SessionSnapshot } from "@/lib/session-state";

const SessionContext = createContext<ReturnType<typeof createSessionStore> | null>(null);

export function SessionProvider({ children, initialSession = { status: "loading" } }: {
  children: ReactNode;
  initialSession?: SessionSnapshot;
}) {
  const pathname = usePathname();
  const [store] = useState(() => createSessionStore(initialSession, async () => {
    try {
      return sessionForUser((await getCurrentUser()).user);
    } catch (error) {
      return { status: error instanceof ApiError && error.status === 401 ? "anonymous" : "unavailable" };
    }
  }));

  useEffect(() => {
    const refresh = () => { void store.refresh(); };
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("callassist:session-ended", store.endSession);
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", onVisible);
    refresh();
    return () => {
      window.removeEventListener("callassist:session-ended", store.endSession);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pathname, store]);

  return <SessionContext.Provider value={store}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const store = useContext(SessionContext);
  if (!store) throw new Error("useSession requires SessionProvider");
  const session = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  return { session, refreshSession: store.refresh };
}
