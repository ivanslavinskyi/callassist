"use client";

import {
  SUPPORTED_CALL_LANGUAGES,
  type CallBrief,
  type CallLocale,
  type CreateCallBriefInput
} from "@callassist/contracts";
import { useMemo, useState, type FormEvent } from "react";
import { createCallBrief } from "@/lib/api";

const initialForm: CreateCallBriefInput = {
  recipientName: "Gemeinde Aadorf",
  phoneNumber: "+41523686688",
  objective: "Уточнить, можно ли отправить запрошенные документы по электронной почте",
  locale: "de-CH",
  allowLanguageSwitch: false,
  allowedFacts: ["Имя владельца", "Место проживания", "Предпочтение письменного ответа"]
};

export function CreateCallForm({ onCreated }: { onCreated: (brief: CallBrief) => void }) {
  const [form, setForm] = useState<CreateCallBriefInput>(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fallbackLanguages = useMemo(
    () => SUPPORTED_CALL_LANGUAGES.filter(({ locale }) => locale !== form.locale),
    [form.locale]
  );

  function update<Value extends keyof CreateCallBriefInput>(
    field: Value,
    value: CreateCallBriefInput[Value]
  ) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const brief = await createCallBrief(form);
      onCreated(brief);
    } catch {
      setError("Не удалось создать задание. Проверьте поля и доступность API.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="call-form" onSubmit={handleSubmit}>
      <div className="form-heading">
        <div>
          <span className="eyebrow">Новое задание</span>
          <h2>Кому и зачем звоним?</h2>
        </div>
        <span className="mode-badge">Mock mode</span>
      </div>

      <div className="form-grid">
        <label className="field field-wide">
          <span>Организация или адресат</span>
          <input
            value={form.recipientName}
            onChange={(event) => update("recipientName", event.target.value)}
            placeholder="Gemeinde Aadorf"
            required
          />
        </label>

        <label className="field">
          <span>Телефон</span>
          <input
            value={form.phoneNumber}
            onChange={(event) => update("phoneNumber", event.target.value)}
            placeholder="+41..."
            inputMode="tel"
            required
          />
          <small>Международный формат E.164</small>
        </label>

        <label className="field">
          <span>Язык звонка</span>
          <select
            value={form.locale}
            onChange={(event) => update("locale", event.target.value as CallLocale)}
          >
            {SUPPORTED_CALL_LANGUAGES.map(({ locale, label }) => (
              <option key={locale} value={locale}>
                {label}
              </option>
            ))}
          </select>
          <small>Фиксируется в задании и транскрипте</small>
        </label>

        <label className="field field-wide">
          <span>Цель звонка</span>
          <textarea
            value={form.objective}
            onChange={(event) => update("objective", event.target.value)}
            rows={4}
            required
          />
        </label>
      </div>

      <div className="language-policy">
        <label className="switch-row">
          <input
            type="checkbox"
            checked={form.allowLanguageSwitch}
            onChange={(event) => {
              const enabled = event.target.checked;
              setForm((current) => ({
                ...current,
                allowLanguageSwitch: enabled,
                fallbackLocale: enabled
                  ? (current.fallbackLocale ?? fallbackLanguages[0]?.locale)
                  : undefined
              }));
            }}
          />
          <span className="switch-control" aria-hidden="true" />
          <span>
            <strong>Разрешить смену языка</strong>
            <small>Ассистент сможет перейти только на выбранный резервный язык</small>
          </span>
        </label>

        {form.allowLanguageSwitch ? (
          <label className="field fallback-field">
            <span>Резервный язык</span>
            <select
              value={form.fallbackLocale}
              onChange={(event) =>
                update("fallbackLocale", event.target.value as CallLocale)
              }
            >
              {fallbackLanguages.map(({ locale, label }) => (
                <option key={locale} value={locale}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <div className="allowed-facts">
        <div>
          <span className="section-label">Разрешено сообщить без подтверждения</span>
          <p>Чувствительные значения в этот список не входят.</p>
        </div>
        <div className="fact-list">
          {(form.allowedFacts ?? []).map((fact) => (
            <span className="fact-chip" key={fact}>
              <span aria-hidden="true">✓</span> {fact}
            </span>
          ))}
        </div>
      </div>

      {error ? <p className="form-error">{error}</p> : null}

      <button className="primary-button" disabled={submitting} type="submit">
        <span>{submitting ? "Создаём…" : "Создать задание"}</span>
        <span aria-hidden="true">→</span>
      </button>
    </form>
  );
}
