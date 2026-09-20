"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { defaultAnalyticsSettings } from "@callassist/contracts";
import { getPublicAnalyticsSettings } from "@/lib/api";
import { analyticsPath, configureAnalytics, trackPageView } from "@/lib/analytics";
import { readPrivacyPreferences } from "@/lib/privacy-preferences";

export function AnalyticsTracker() {
  const pathname = usePathname();
  useEffect(() => {
    let active = true;
    let request = 0;
    const refresh = async () => {
      const current = ++request;
      const settings = analyticsPath(pathname) === null ? defaultAnalyticsSettings : await getPublicAnalyticsSettings().catch(() => defaultAnalyticsSettings);
      if (!active || current !== request) return;
      configureAnalytics(settings, readPrivacyPreferences()); trackPageView(pathname);
    };
    void refresh();
    const onChange = () => void refresh();
    window.addEventListener("focus", onChange); window.addEventListener("callassist:privacy-changed", onChange); window.addEventListener("storage", onChange);
    // Pick up an operator's disable action in already-open tabs.
    const interval = window.setInterval(onChange, 60_000);
    return () => { active = false; window.clearInterval(interval); window.removeEventListener("focus", onChange); window.removeEventListener("callassist:privacy-changed", onChange); window.removeEventListener("storage", onChange); };
  }, [pathname]);
  return null;
}
