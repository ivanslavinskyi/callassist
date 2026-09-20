"use client";
import { useEffect, useState } from "react";
import type { UiLocale } from "@callassist/contracts";
import { acknowledgePrivacyNotice, readPrivacyPreferences } from "@/lib/privacy-preferences";
import { privacyMessages } from "@/lib/i18n/privacy-messages";
export function PrivacyNotice({ locale }: { locale: UiLocale }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const sync = () => setVisible(!readPrivacyPreferences().acknowledgedAt);
    sync(); window.addEventListener("storage", sync); window.addEventListener("callassist:privacy-changed", sync);
    return () => { window.removeEventListener("storage", sync); window.removeEventListener("callassist:privacy-changed", sync); };
  }, []);
  if (!visible) return null;
  const copy = privacyMessages[locale];
  return <aside className="privacy-notice" aria-label={copy.notice} lang={locale}>
    <p>{copy.notice}</p><button type="button" className="secondary-button" onClick={acknowledgePrivacyNotice}>{copy.acknowledge}</button>
  </aside>;
}
