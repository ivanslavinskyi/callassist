"use client";

import type { RecipientSuggestion } from "@callassist/contracts";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent
} from "react";
import { listRecipientSuggestions } from "@/lib/api";
import { useUiLocale } from "./ui-locale-provider";

type RecipientComboboxProps = {
  enabled: boolean;
  value: string;
  onChange: (value: string) => void;
  onSelect: (suggestion: RecipientSuggestion) => void;
};

export function RecipientCombobox({
  enabled,
  value,
  onChange,
  onSelect
}: RecipientComboboxProps) {
  const { messages } = useUiLocale();
  const copy = messages.form.copy;
  const inputId = useId();
  const listboxId = `${inputId}-suggestions`;
  const requestId = useRef(0);
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<RecipientSuggestion[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    if (!enabled || !open) return;
    const currentRequest = ++requestId.current;
    setStatus("loading");
    const timeout = window.setTimeout(() => {
      void listRecipientSuggestions({
        query: value.trim() || undefined,
        limit: 10
      }).then((result) => {
        if (currentRequest !== requestId.current) return;
        setSuggestions(result.items);
        setActiveIndex((current) =>
          result.items.length === 0 ? -1 : Math.min(current, result.items.length - 1)
        );
        setStatus("loaded");
      }).catch(() => {
        if (currentRequest !== requestId.current) return;
        setSuggestions([]);
        setActiveIndex(-1);
        setStatus("error");
      });
    }, 250);

    return () => {
      window.clearTimeout(timeout);
      requestId.current += 1;
    };
  }, [enabled, open, value]);

  function selectSuggestion(suggestion: RecipientSuggestion) {
    onSelect(suggestion);
    setOpen(false);
    setActiveIndex(-1);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) =>
        suggestions.length === 0 ? -1 : Math.min(current + 1, suggestions.length - 1)
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) =>
        suggestions.length === 0
          ? -1
          : current <= 0 ? suggestions.length - 1 : current - 1
      );
      return;
    }
    if (event.key === "Enter" && open && activeIndex >= 0) {
      event.preventDefault();
      const suggestion = suggestions[activeIndex];
      if (suggestion) selectSuggestion(suggestion);
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  if (!enabled) {
    return (
      <label className="field field-wide">
        <span>{copy.recipient}</span>
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={copy.recipientPlaceholder}
          required
        />
      </label>
    );
  }

  const showPopup = open && (
    suggestions.length > 0 || status === "loading" || status === "error" || status === "loaded"
  );

  return (
    <div
      className="field field-wide recipient-combobox"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
          setActiveIndex(-1);
        }
      }}
    >
      <label className="recipient-combobox-label" htmlFor={inputId}>
        {copy.recipient}
      </label>
      <input
        id={inputId}
        role="combobox"
        aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-expanded={open}
        autoComplete="off"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setSuggestions([]);
          setStatus("loading");
          setOpen(true);
          setActiveIndex(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={copy.recipientPlaceholder}
        required
      />

      {showPopup ? (
        <div className="recipient-suggestions-popup">
          <div
            aria-busy={status === "loading"}
            className="recipient-suggestions"
            id={listboxId}
            role="listbox"
          >
            {suggestions.map((suggestion, index) => (
              <div
                aria-selected={activeIndex === index}
                className="recipient-suggestion"
                id={`${listboxId}-${index}`}
                key={`${suggestion.recipientName}\0${suggestion.phoneNumber}`}
                onClick={() => selectSuggestion(suggestion)}
                onMouseEnter={() => setActiveIndex(index)}
                onPointerDown={(event) => event.preventDefault()}
                role="option"
              >
                <strong>{suggestion.recipientName}</strong>
                <span>{suggestion.phoneNumber}</span>
              </div>
            ))}
          </div>
          {suggestions.length === 0 ? (
            <div className="recipient-suggestions-status" role="status">
              {status === "error"
                ? copy.recipientHistoryError
                : status === "loaded"
                  ? (value.trim() ? copy.recipientNoMatches : copy.recipientNoHistory)
                  : copy.recipientHistoryLoading}
            </div>
          ) : null}
          {suggestions.length > 0 && status === "loading" ? (
            <span className="sr-only" role="status">{copy.recipientHistoryLoading}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
