"use client";

import { useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import { uiLocales, uiLocaleRegistry, type UiLocale } from "@callassist/contracts";

/** A disclosure of native buttons: Tab, Enter/Space, arrows, Home/End and Escape. */
export function LanguageSwitcher({ locale, label, disabled, onChange }: {
  locale: UiLocale; label: string; disabled?: boolean; onChange: (locale: UiLocale) => void;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && open) { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  useEffect(() => {
    if (open) ref.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
  }, [open]);
  return <div className="language-switcher" ref={ref} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }}>
    <button ref={trigger} type="button" className="icon-button" disabled={disabled} aria-label={`${label}: ${uiLocaleRegistry[locale].nativeName}`}
      aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}
      onKeyDown={event => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); } }}>
      {uiLocaleRegistry[locale].shortCode}
    </button>
    {open && <div className="language-options" id={id} role="group" aria-label={label} onKeyDown={event => {
      const buttons = Array.from(event.currentTarget.querySelectorAll("button"));
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "ArrowDown" ? (index + 1) % buttons.length : event.key === "ArrowUp" ? (index - 1 + buttons.length) % buttons.length : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : null;
      if (next !== null) { event.preventDefault(); buttons[next]?.focus(); }
    }}>
      {uiLocales.map((code, index) => <button type="button" key={code} lang={code} aria-pressed={code === locale}
        className={index > 0 && uiLocaleRegistry[uiLocales[index - 1]!].group !== uiLocaleRegistry[code].group ? "language-group-start" : undefined}
        onClick={() => { setOpen(false); trigger.current?.focus(); if (code !== locale) onChange(code); }}>
        <Image className="language-medallion" src={`/brand/languages/${uiLocaleRegistry[code].medallion}.png`}
          width={32} height={32} alt="" aria-hidden="true" unoptimized />
        <span className="language-option-name">{uiLocaleRegistry[code].nativeName}</span>
        <span className="language-option-check" aria-hidden="true">{code === locale ? "✓" : ""}</span>
      </button>)}
    </div>}
  </div>;
}
