"use client";

import {
  DEFAULT_SPEECH_IMPAIRMENT_DISCLOSURES,
  SUPPORTED_CALL_LANGUAGES,
  type CallBrief,
  type CallLocale,
  type CallVoiceGender,
  type CreateCallBriefInput
} from "@callassist/contracts";
import { useMemo, useState, type FormEvent } from "react";
import { createCallBrief } from "@/lib/api";

const initialForm: CreateCallBriefInput = {
  recipientName: "Gemeinde Aadorf",
  phoneNumber: "+41523686688",
  objective: "Ask whether the requested documents may be sent by email",
  agentName: "Sebastian",
  representedPerson: "Ivan Slavinskyi",
  speechImpairmentDisclosure: DEFAULT_SPEECH_IMPAIRMENT_DISCLOSURES["de-CH"],
  context: "",
  locale: "de-CH",
  voiceGender: "male",
  audioRetentionDays: 7,
  allowLanguageSwitch: false,
  allowedFacts: ["Owner's full name", "Place of residence", "Preference for a written reply"]
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
      setError("Could not create the call brief. Check the fields and API availability.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="call-form" onSubmit={handleSubmit}>
      <div className="form-heading">
        <div>
          <span className="eyebrow">New call brief</span>
          <h2>Who are we calling, and why?</h2>
        </div>
        <span className="mode-badge">AI call</span>
      </div>

      <div className="form-grid">
        <label className="field field-wide">
          <span>Organisation or recipient</span>
          <input
            value={form.recipientName}
            onChange={(event) => update("recipientName", event.target.value)}
            placeholder="Gemeinde Aadorf"
            required
          />
        </label>

        <label className="field">
          <span>Phone number</span>
          <input
            value={form.phoneNumber}
            onChange={(event) => update("phoneNumber", event.target.value)}
            placeholder="+41..."
            inputMode="tel"
            required
          />
          <small>International E.164 format</small>
        </label>

        <label className="field">
          <span>Call language</span>
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
          <small>Stored with the brief and transcript</small>
        </label>

        <label className="field field-wide">
          <span>Call objective</span>
          <textarea
            value={form.objective}
            onChange={(event) => update("objective", event.target.value)}
            rows={4}
            required
          />
        </label>

        <label className="field">
          <span>AI assistant name</span>
          <input
            value={form.agentName ?? ""}
            onChange={(event) => update("agentName", event.target.value)}
            placeholder="Sebastian"
            required
          />
        </label>

        <label className="field">
          <span>Assistant voice</span>
          <select
            value={form.voiceGender ?? "male"}
            onChange={(event) =>
              update("voiceGender", event.target.value as CallVoiceGender)
            }
          >
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>
          <small>Used for both the disclosure and conversation</small>
        </label>

        <label className="field">
          <span>Audio retention</span>
          <select
            value={form.audioRetentionDays ?? 7}
            onChange={(event) =>
              update(
                "audioRetentionDays",
                Number(event.target.value) as 0 | 7 | 30
              )
            }
          >
            <option value={0}>Delete after final transcript</option>
            <option value={7}>Keep for 7 days</option>
            <option value={30}>Keep for 30 days</option>
          </select>
          <small>Recording starts only after the recipient presses 1</small>
        </label>

        <label className="field field-wide">
          <span>Represented person</span>
          <input
            value={form.representedPerson ?? ""}
            onChange={(event) => update("representedPerson", event.target.value)}
            placeholder="Ivan Slavinskyi"
            required
          />
        </label>

        <label className="field field-wide">
          <span>Disclosure before consent</span>
          <textarea
            value={form.speechImpairmentDisclosure ?? ""}
            onChange={(event) =>
              update("speechImpairmentDisclosure", event.target.value)
            }
            rows={3}
            required
          />
          <small>
            This statement is spoken before the recording notice and the request to press 1.
          </small>
        </label>

        <label className="field field-wide">
          <span>Assistant context</span>
          <textarea
            value={form.context ?? ""}
            onChange={(event) => update("context", event.target.value)}
            rows={6}
            placeholder="CV, cover letter, company details, and communication history…"
          />
          <small>
            Context guides the conversation. List any facts approved for disclosure below.
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
            <strong>Allow language switching</strong>
            <small>The assistant may switch only to the selected fallback language</small>
          </span>
        </label>

        {form.allowLanguageSwitch ? (
          <label className="field fallback-field">
            <span>Fallback language</span>
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
          <span className="section-label">Approved for disclosure without confirmation</span>
          <p>Enter one verified fact per line. The assistant must not infer missing information.</p>
        </div>
        <label className="field field-wide">
          <span>Approved facts</span>
          <textarea
            value={factsText}
            onChange={(event) => setFactsText(event.target.value)}
            rows={6}
            placeholder={"Full name: Ivan Slavinskyi\nApplication sent: 12 July 2026"}
          />
        </label>
      </div>

      {error ? <p className="form-error">{error}</p> : null}

      <button className="primary-button" disabled={submitting} type="submit">
        <span>{submitting ? "Creating…" : "Create call brief"}</span>
        <span aria-hidden="true">→</span>
      </button>
    </form>
  );
}
