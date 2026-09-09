"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getLanguageCapabilities, type LanguageCapabilities } from "@/lib/api";
export { canGenerateText } from "@/lib/text-capabilities";

export function useTextCapabilities() {
  const [capabilities, setCapabilities] = useState<LanguageCapabilities | null>(null);
  const [availabilityStatus, setAvailabilityStatus] = useState<"loading" | "ready" | "error">("loading");
  const readVersion = useRef(0);
  const mounted = useRef(true);
  const refreshCapabilities = useCallback(async () => {
    const version = ++readVersion.current;
    if (mounted.current) setAvailabilityStatus("loading");
    try {
      const result = await getLanguageCapabilities();
      if (mounted.current && readVersion.current === version) {
        setCapabilities(result); setAvailabilityStatus("ready");
      }
    } catch {
      if (mounted.current && readVersion.current === version) setAvailabilityStatus("error");
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const refresh = () => { void refreshCapabilities(); };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => {
      mounted.current = false; readVersion.current += 1;
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [refreshCapabilities]);
  return { capabilities, availabilityStatus, refreshCapabilities };
}
