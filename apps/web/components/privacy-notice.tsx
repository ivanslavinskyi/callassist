"use client";
import { useEffect, useRef, useState } from "react";
import type { UiLocale } from "@callassist/contracts";
import { acknowledgePrivacyNotice, readPrivacyPreferences } from "@/lib/privacy-preferences";
import { privacyMessages } from "@/lib/i18n/privacy-messages";
export function PrivacyNotice({ locale }: { locale: UiLocale }) {
  const [visible, setVisible] = useState(false);
  const noticeRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const sync = () => setVisible(!readPrivacyPreferences().acknowledgedAt);
    sync(); window.addEventListener("storage", sync); window.addEventListener("callassist:privacy-changed", sync);
    return () => { window.removeEventListener("storage", sync); window.removeEventListener("callassist:privacy-changed", sync); };
  }, []);
  useEffect(() => {
    const notice = noticeRef.current;
    if (!visible || !notice) return;
    const updateClearance = () => {
      document.documentElement.style.setProperty(
        "--privacy-notice-clearance",
        `${Math.ceil(notice.getBoundingClientRect().height) + 16}px`
      );
    };
    updateClearance();
    const observer = new ResizeObserver(updateClearance);
    observer.observe(notice);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--privacy-notice-clearance");
    };
  }, [visible]);
  if (!visible) return null;
  const copy = privacyMessages[locale];
  return <aside ref={noticeRef} className="privacy-notice" aria-label={copy.notice} lang={locale}>
    <p>{copy.notice}</p><button type="button" className="secondary-button" onClick={acknowledgePrivacyNotice}>{copy.acknowledge}</button>
  </aside>;
}
