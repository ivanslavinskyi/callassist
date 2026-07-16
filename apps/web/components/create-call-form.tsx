"use client";

import {
  DEFAULT_SPEECH_IMPAIRMENT_DISCLOSURES,
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
  agentName: "Sebastian",
  representedPerson: "Ivan Slavinskyi",
  speechImpairmentDisclosure: DEFAULT_SPEECH_IMPAIRMENT_DISCLOSURES["de-CH"],
  context: "",
  locale: "de-CH",
  allowLanguageSwitch: false,
  allowedFacts: ["Имя владельца", "Место проживания", "Предпочтение письменного ответа"]
};

export function CreateCallForm({ onCreated }: { onCreated: (brief: CallBrief) => void }) {
  const [form, setForm] = useState<CreateCallBriefInput>(initialForm);
  const [factsText, setFactsText] = useState(
    (initialForm.allowedFacts ?? []).join("\n")
  );
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
      const brief = await createCallBrief({
        ...form,
        allowedFacts: factsText
          .split("\n")
          .map((fact) => fact.trim())
          .filter(Boolean)
      });
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
        <span className="mode-badge">AI call</span>
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
            onChange={(event) => {
              const locale = event.target.value as CallLocale;
              setForm((current) => {
                const disclosure = current.speechImpairmentDisclosure ?? "";
                const usesDefaultDisclosure = Object.values(
                  DEFAULT_SPEECH_IMPAIRMENT_DISCLOSURES
                ).includes(disclosure);
                return {
                  ...current,
                  locale,
                  speechImpairmentDisclosure: usesDefaultDisclosure
                    ? DEFAULT_SPEECH_IMPAIRMENT_DISCLOSURES[locale]
                    : disclosure
                };
              });
            }}
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

        <label className="field">
          <span>Имя ИИ-ассистента</span>
          <input
            value={form.agentName ?? ""}
            onChange={(event) => update("agentName", event.target.value)}
            placeholder="Sebastian"
            required
          />
        </label>

        <label className="field">
          <span>Кого представляет</span>
          <input
            value={form.representedPerson ?? ""}
            onChange={(event) => update("representedPerson", event.target.value)}
            placeholder="Ivan Slavinskyi"
            required
          />
        </label>

        <label className="field field-wide">
          <span>Объяснение перед запросом согласия</span>
          <textarea
            value={form.speechImpairmentDisclosure ?? ""}
            onChange={(event) =>
              update("speechImpairmentDisclosure", event.target.value)
            }
            rows={3}
            required
          />
          <small>
            Эта фраза прозвучит до уведомления о транскрипции и просьбы нажать 1.
          </small>
        </label>

        <label className="field field-wide">
          <span>Контекст для ассистента</span>
          <textarea
            value={form.context ?? ""}
            onChange={(event) => update("context", event.target.value)}
            rows={6}
            placeholder="Резюме, мотивационное письмо, сведения о компании и история обращения…"
          />
          <small>
            Контекст помогает вести разговор, но конкретные данные для раскрытия перечислите ниже.
          </small>
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
          <p>Один проверенный факт на строку. Ассистенту запрещено додумывать отсутствующие данные.</p>
        </div>
        <label className="field field-wide">
          <span>Разрешённые факты</span>
          <textarea
            value={factsText}
            onChange={(event) => setFactsText(event.target.value)}
            rows={6}
            placeholder={"Полное имя: Ivan Slavinskyi\nДата отправки Bewerbung: 12.07.2026"}
          />
        </label>
      </div>

      {error ? <p className="form-error">{error}</p> : null}

      <button className="primary-button" disabled={submitting} type="submit">
        <span>{submitting ? "Создаём…" : "Создать задание"}</span>
        <span aria-hidden="true">→</span>
      </button>
    </form>
  );
}
