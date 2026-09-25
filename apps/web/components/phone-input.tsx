"use client";
import { normalizeAccountPhoneNumber, parseAccountPhoneNumber, verificationPhoneCountry } from "@callassist/contracts";
import { getRegistrationOptions } from "@/lib/api";
import { useEffect, useId, useRef, useState } from "react";
import { useUiLocale } from "./ui-locale-provider";
import { registrationCallMessages } from "@/lib/i18n/registration-call-messages";

export function PhoneInput({ name, defaultValue = "", value, onChange, countries, inputId, inputRef, describedBy, invalid, destination = false, required = true, disabled = false }: {
  name?: string; defaultValue?: string; value?: string; inputId?: string; inputRef?: (node: HTMLInputElement | null) => void; onChange?: (value: string) => void; countries?: string[]; required?: boolean; disabled?: boolean;
  describedBy?: string; invalid?: boolean; destination?: boolean;
}) {
  const { locale } = useUiLocale();
  const copy = registrationCallMessages[locale];
  const [raw, setRaw] = useState(value ?? defaultValue);
  const [country, setCountry] = useState(verificationPhoneCountry(value ?? defaultValue) ?? "CH");
  const input = useRef<HTMLInputElement>(null);
  const lastEmitted = useRef(value ?? defaultValue);
  const [allowed, setAllowed] = useState(["CH", "UA"]);
  const [countryNames, setCountryNames] = useState<Record<string, string>>({});
  useEffect(() => {
    const names = new Intl.DisplayNames([locale], { type: "region" });
    setCountryNames(Object.fromEntries([...new Set([...(countries ?? allowed), country])].map(code => [code, names.of(code) ?? code])));
  }, [locale, countries, allowed, country]);
  useEffect(() => { if (value !== undefined && value !== lastEmitted.current) { lastEmitted.current = value; setRaw(value); const next = verificationPhoneCountry(value); if (next) setCountry(next); } }, [value]);
  useEffect(() => { if (countries) return; let active = true; void getRegistrationOptions(locale).then(options => { if (active) setAllowed(options.smsCountries); }).catch(() => undefined); return () => { active = false; }; }, [locale, countries]);
  const id = useId();
  const canonical = parseAccountPhoneNumber(raw, country);
  useEffect(() => { input.current?.setCustomValidity(raw && !canonical ? copy.invalidPhone : ""); }, [raw, canonical, copy.invalidPhone]);
  function update(value: string, selected = country) {
    setRaw(value);
    const international = /^\s*(\+|00)/.test(value) ? verificationPhoneCountry(normalizeAccountPhoneNumber(value)) : null;
    if (international) setCountry(international);
    lastEmitted.current = parseAccountPhoneNumber(value, international ?? selected) ?? value;
    onChange?.(lastEmitted.current);
  }
  return <span className="phone-input">
    <select aria-label={copy.country} disabled={disabled} value={country} onChange={event => {
      setCountry(event.target.value); update(raw, event.target.value);
    }}>{[...new Set([...(countries ?? allowed), country])].map(code => <option key={code} value={code}>{code === "CH" ? copy.switzerland : code === "UA" ? copy.ukraine : countryNames[code] ?? code} ({code})</option>)}</select>
    <input ref={node => { input.current = node; inputRef?.(node); }} id={inputId} aria-label={copy.phone} aria-describedby={[id, describedBy].filter(Boolean).join(" ")} aria-invalid={invalid || (raw ? !canonical : undefined)} autoComplete="tel" type="tel" inputMode="tel" maxLength={40} required={required} disabled={disabled}
      value={raw} onChange={event => update(event.target.value)} />
    {name ? <input type="hidden" name={name} value={canonical ?? raw} /> : null}
    <small id={id}>{canonical ? `${destination ? copy.phone : copy.phonePreview}: ${canonical}` : copy.invalidPhone}</small>
  </span>;
}
