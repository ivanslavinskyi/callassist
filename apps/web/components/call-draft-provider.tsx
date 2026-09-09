"use client";

import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { CallDraftStore } from "@/lib/call-draft-store";

const CallDraftContext = createContext<CallDraftStore | null>(null);

export function CallDraftProvider({ children }: { children: ReactNode }) {
  const store = useRef(new CallDraftStore());
  useEffect(() => {
    const clear = () => store.current.clearAll();
    window.addEventListener("callassist:session-ended", clear);
    return () => window.removeEventListener("callassist:session-ended", clear);
  }, []);
  return <CallDraftContext.Provider value={store.current}>{children}</CallDraftContext.Provider>;
}

export function useCallDraftStore() {
  const store = useContext(CallDraftContext);
  if (!store) throw new Error("CallDraftProvider is required");
  return store;
}
