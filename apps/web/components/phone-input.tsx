"use client";
import { normalizeAccountPhoneNumber, parseAccountPhoneNumber, verificationPhoneCountry } from "@callassist/contracts";
import { getRegistrationOptions } from "@/lib/api";
import { useEffect, useId, useRef, useState } from "react";
import { useUiLocale } from "./ui-locale-provider";
import { registrationCallMessages } from "@/lib/i18n/registration-call-messages";

export function refreshAccountPhonePolicy() { window.dispatchEvent(new Event("account-phone-policy-refresh")); }

export function PhoneInput({ name, defaultValue = "", value, onChange, countries, swissOnly, inputId, inputRef, describedBy, invalid, destination = false, required = true, disabled = false }: {
  name?: string; defaultValue?: string; value?: string; inputId?: string; inputRef?: (node: HTMLInputElement | null) => void; onChange?: (value: string) => void; countries?: string[]; required?: boolean; disabled?: boolean;
  describedBy?: string; invalid?: boolean; destination?: boolean; swissOnly?: boolean;
}) {
  const { locale } = useUiLocale();
  const copy = registrationCallMessages[locale];
  const [raw, setRaw] = useState(value ?? defaultValue);
  const [country, setCountry] = useState(verificationPhoneCountry(value ?? defaultValue) ?? "CH");
  const input = useRef<HTMLInputElement>(null);
  const lastEmitted = useRef(value ?? defaultValue);
  const [allowed, setAllowed] = useState(["CH", "UA"]);
  const [restricted, setRestricted] = useState(swissOnly ?? false);
  const [loaded, setLoaded] = useState(Boolean(countries));
  const [loadError, setLoadError] = useState(false);
  const swiss = swissOnly ?? restricted;
  const [countryNames, setCountryNames] = useState<Record<string, string>>({});
  useEffect(() => {
    const names = new Intl.DisplayNames([locale], { type: "region" });
    setCountryNames(Object.fromEntries([...new Set([...(countries ?? allowed), country])].map(code => [code, names.of(code) ?? code])));
  }, [locale, countries, allowed, country]);
  useEffect(() => { if (value !== undefined && value !== lastEmitted.current) { lastEmitted.current = value; setRaw(value); const next = verificationPhoneCountry(value); if (next) setCountry(next); } }, [value]);
  useEffect(() => {
    if (countries) { setLoaded(true); return; }
    let active = true, sequence = 0;
    const load = () => { const request = ++sequence; setLoaded(false); setLoadError(false); void getRegistrationOptions(locale).then(options => {
      if (active && request === sequence) { setAllowed(options.smsCountries); setRestricted(options.policy.swissPhonesOnly); setLoaded(true); }
    }).catch(() => { if (active && request === sequence) setLoadError(true); }); };
    load(); window.addEventListener("account-phone-policy-refresh", load);
    return () => { active = false; window.removeEventListener("account-phone-policy-refresh", load); };
  }, [locale, countries]);
  const id = useId();
  const parsed = parseAccountPhoneNumber(raw, swiss ? "CH" : country);
  const canonical = parsed && (!swiss || verificationPhoneCountry(parsed) === "CH") ? parsed : null;
  const invalidMessage = swiss ? copy.swissPhoneRequired : copy.invalidPhone;
  useEffect(() => { input.current?.setCustomValidity(!loaded ? copy.optionsError : raw && !canonical ? invalidMessage : ""); }, [raw, canonical, loaded, invalidMessage, copy.optionsError]);
  function update(value: string, selected = country) {
    setRaw(value);
    const international = /^\s*(\+|00)/.test(value) ? verificationPhoneCountry(normalizeAccountPhoneNumber(value)) : null;
    if (international && !swiss) setCountry(international);
    const normalized = parseAccountPhoneNumber(value, swiss ? "CH" : international ?? selected);
    lastEmitted.current = normalized && (!swiss || verificationPhoneCountry(normalized) === "CH") ? normalized : value;
    onChange?.(lastEmitted.current);
  }
  return <span className="phone-input">
    {loaded && !swiss && <select aria-label={copy.country} disabled={disabled} value={country} onChange={event => {
      setCountry(event.target.value); update(raw, event.target.value);
    }}>{[...new Set([...(countries ?? allowed), country])].map(code => <option key={code} value={code}>{code === "CH" ? copy.switzerland : code === "UA" ? copy.ukraine : countryNames[code] ?? code} ({code})</option>)}</select>}
    <input ref={node => { input.current = node; inputRef?.(node); }} id={inputId} aria-label={copy.phone} aria-describedby={[id, describedBy].filter(Boolean).join(" ")} aria-invalid={invalid || (raw ? !canonical : undefined)} autoComplete="tel" type="tel" inputMode="tel" maxLength={40} required={required} disabled={disabled}
      readOnly={!loaded} value={raw} onChange={event => update(event.target.value)} />
    {name ? <input type="hidden" name={name} value={canonical ?? raw} /> : null}
    <small id={id}>{!loaded ? (loadError ? copy.optionsError : copy.phonePolicyLoading) : <>{swiss ? copy.swissPhoneHelp : copy.accountPhoneHelp}{raw && <><br />{canonical ? `${destination ? copy.phone : copy.phonePreview}: ${canonical}` : invalidMessage}</>}</>}</small>
    {loadError && <button type="button" onClick={refreshAccountPhonePolicy}>{copy.reload}</button>}
  </span>;
}
