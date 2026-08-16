"use client";

import {
  ASSISTANT_PROFILES,
  DEFAULT_REPRESENTED_PERSON,
  SUPPORTED_CALL_LANGUAGES,
  getAssistanceDisclosure,
  type AssistanceReason,
  type AssistantProfileId,
  type CallBrief,
  type CallLocale,
  type CreateCallBriefInput
} from "@callassist/contracts";
import { useMemo, useState, type FormEvent } from "react";
import {
  createCallBrief,
  getCallPreparationErrorMessage
} from "@/lib/api";

const emptyForm: CreateCallBriefInput = {
  recipientName: "",
  phoneNumber: "",
  objective: "",
  assistantProfileId: "sebastian",
  representedPerson: DEFAULT_REPRESENTED_PERSON,
  assistanceReason: "speech_impairment",
  context: "",
  locale: "de-CH",
  audioRetentionDays: 7,
  allowLanguageSwitch: false,
  allowedFacts: [],
  resultHandling: "capture_in_callassist",
  addressingMode: "formal",
  tonePreference: "auto",
  voicemailPolicy: "do_not_leave_details",
  deliveryInstruction: "",
  clarificationAnswers: []
};

const legacyDemoFacts = [
  "Owner's full name",
  "Place of residence",
  "Preference for a written reply"
];

type CreateCallFormProps = {
  onCreated: (brief: CallBrief) => void;
  initialValue?: CreateCallBriefInput;
  saveCallBrief?: (input: CreateCallBriefInput) => Promise<CallBrief>;
  heading?: string;
  submitLabel?: string;
  onCancel?: () => void;
};

export function CreateCallForm({
  onCreated,
  initialValue,
  saveCallBrief = createCallBrief,
  heading = "Who are we calling, and why?",
  submitLabel = "Review call",
  onCancel
}: CreateCallFormProps) {
  const [form, setForm] = useState<CreateCallBriefInput>(() => ({
    ...emptyForm,
    ...initialValue,
    allowedFacts: cleanLegacyDemoFacts(initialValue?.allowedFacts),
    clarificationAnswers: initialValue?.clarificationAnswers ?? []
  }));
  const [factsText, setFactsText] = useState(() =>
    cleanLegacyDemoFacts(initialValue?.allowedFacts).join("\n")
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fallbackLanguages = useMemo(
    () => SUPPORTED_CALL_LANGUAGES.filter(({ locale }) => locale !== form.locale),
    [form.locale]
  );
  const disclosurePreview = useMemo(
    () =>
      getAssistanceDisclosure(
        form.locale,
        form.assistanceReason,
        form.representedPerson ?? ""
      ),
    [form.assistanceReason, form.locale, form.representedPerson]
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
      const brief = await saveCallBrief({
        ...form,
        allowedFacts: factsText
          .split("\n")
          .map((fact) => fact.trim())
          .filter(Boolean)
      });
      onCreated(brief);
    } catch (error) {
      setError(getCallPreparationErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="call-form" onSubmit={handleSubmit}>
      <div className="form-heading">
        <div>
          <span className="eyebrow">{initialValue ? "Edit call brief" : "New call brief"}</span>
          <h2>{heading}</h2>
        </div>
        <span className="mode-badge">AI call</span>
      </div>

      <div className="form-grid">
        <label className="field field-wide">
          <span>Organisation or recipient</span>
          <input
            value={form.recipientName}
            onChange={(event) => update("recipientName", event.target.value)}
            placeholder="Elena or Gemeinde Aadorf"
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
            onChange={(event) => update("locale", event.target.value as CallLocale)}
          >
            {SUPPORTED_CALL_LANGUAGES.map(({ locale, label }) => (
              <option key={locale} value={locale}>{label}</option>
            ))}
          </select>
        </label>

        <label className="field field-wide">
          <span>What should the assistant do?</span>
          <textarea
            value={form.objective}
            onChange={(event) => update("objective", event.target.value)}
            placeholder="Describe the goal naturally, in any language."
            rows={5}
            required
          />
          <small>Formal addressing, tone, and spoken-answer handling use safe defaults.</small>
        </label>

        <label className="field">
          <span>AI assistant</span>
          <select
            value={form.assistantProfileId}
            onChange={(event) =>
              update("assistantProfileId", event.target.value as AssistantProfileId)
            }
          >
            <optgroup label="Male voice">
              {ASSISTANT_PROFILES.filter(({ voiceGender }) => voiceGender === "male").map(
                ({ id, displayName }) => <option key={id} value={id}>{displayName}</option>
              )}
            </optgroup>
            <optgroup label="Female voice">
              {ASSISTANT_PROFILES.filter(({ voiceGender }) => voiceGender === "female").map(
                ({ id, displayName }) => <option key={id} value={id}>{displayName}</option>
              )}
            </optgroup>
          </select>
        </label>

        <label className="field">
          <span>Reason for assistance</span>
          <select
            value={form.assistanceReason}
            onChange={(event) =>
              update("assistanceReason", event.target.value as AssistanceReason)
            }
          >
            <option value="speech_impairment">Speech impairment</option>
            <option value="language_barrier">Language barrier</option>
          </select>
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
      </div>

      <details className="call-options">
        <summary>Call options</summary>
        <p>Safe defaults work for most calls. Change only what matters for this conversation.</p>

        <div className="form-grid call-options-grid">
          <label className="field">
            <span>Result</span>
            <select
              value={form.resultHandling ?? "capture_in_callassist"}
              onChange={(event) =>
                update(
                  "resultHandling",
                  event.target.value as NonNullable<CreateCallBriefInput["resultHandling"]>
                )
              }
            >
              <option value="capture_in_callassist">Save the spoken answer in CallAssist</option>
              <option value="request_external_delivery">Ask the recipient to send something</option>
              <option value="message_only">Deliver a message only</option>
            </select>
          </label>

          <label className="field">
            <span>Addressing</span>
            <select
              value={form.addressingMode ?? "formal"}
              onChange={(event) =>
                update(
                  "addressingMode",
                  event.target.value as NonNullable<CreateCallBriefInput["addressingMode"]>
                )
              }
            >
              <option value="formal">Formal (default)</option>
              <option value="auto">Automatic by relationship</option>
              <option value="informal">Informal</option>
            </select>
          </label>

          <label className="field">
            <span>Tone</span>
            <select
              value={form.tonePreference ?? "auto"}
              onChange={(event) =>
                update(
                  "tonePreference",
                  event.target.value as NonNullable<CreateCallBriefInput["tonePreference"]>
                )
              }
            >
              <option value="auto">Automatic</option>
              <option value="formal">Formal</option>
              <option value="neutral">Neutral</option>
              <option value="friendly">Friendly</option>
            </select>
          </label>

          <label className="field">
            <span>Voicemail</span>
            <select
              value={form.voicemailPolicy ?? "do_not_leave_details"}
              onChange={(event) =>
                update(
                  "voicemailPolicy",
                  event.target.value as NonNullable<CreateCallBriefInput["voicemailPolicy"]>
                )
              }
            >
              <option value="do_not_leave_details">Do not leave call details</option>
              <option value="leave_neutral_message">Leave a neutral message</option>
            </select>
          </label>

          {form.resultHandling === "request_external_delivery" ? (
            <label className="field field-wide">
              <span>Delivery instruction</span>
              <input
                value={form.deliveryInstruction ?? ""}
                onChange={(event) => update("deliveryInstruction", event.target.value)}
                placeholder="For example: ask them to send it to Ivan in Telegram"
              />
            </label>
          ) : null}

          <label className="field">
            <span>Audio retention</span>
            <select
              value={form.audioRetentionDays ?? 7}
              onChange={(event) =>
                update("audioRetentionDays", Number(event.target.value) as 0 | 7 | 30)
              }
            >
              <option value={0}>Delete after final transcript</option>
              <option value={7}>Keep for 7 days</option>
              <option value={30}>Keep for 30 days</option>
            </select>
          </label>

          <label className="field field-wide">
            <span>Disclosure preview</span>
            <textarea value={disclosurePreview} rows={3} readOnly />
          </label>

          <label className="field field-wide">
            <span>Additional context</span>
            <textarea
              value={form.context ?? ""}
              onChange={(event) => update("context", event.target.value)}
              rows={5}
              placeholder="Relevant background, correspondence or organisation details"
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
              <strong>Allow language switching</strong>
              <small>The assistant may use one selected fallback language.</small>
            </span>
          </label>

          {form.allowLanguageSwitch ? (
            <label className="field fallback-field">
              <span>Fallback language</span>
              <select
                value={form.fallbackLocale}
                onChange={(event) => update("fallbackLocale", event.target.value as CallLocale)}
              >
                {fallbackLanguages.map(({ locale, label }) => (
                  <option key={locale} value={locale}>{label}</option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        <div className="allowed-facts">
          <div>
            <span className="section-label">Information the assistant may share</span>
            <p>Optional. Enter actual verified facts, one per line. Examples are never prefilled.</p>
          </div>
          <label className="field field-wide">
            <span>Approved information</span>
            <textarea
              value={factsText}
              onChange={(event) => setFactsText(event.target.value)}
              rows={5}
              placeholder={"Full name: Ivan Slavinskyi\nApplication sent: 12 July 2026"}
            />
          </label>
        </div>
      </details>

      {error ? <p className="form-error">{error}</p> : null}

      <div className="form-actions">
        {onCancel ? (
          <button className="secondary-button" onClick={onCancel} type="button">
            Cancel
          </button>
        ) : null}
        <button className="primary-button" disabled={submitting} type="submit">
          <span>{submitting ? "Preparing..." : submitLabel}</span>
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </form>
  );
}

function cleanLegacyDemoFacts(facts: string[] | undefined) {
  if (
    facts?.length === legacyDemoFacts.length &&
    facts.every((fact, index) => fact === legacyDemoFacts[index])
  ) {
    return [];
  }
  return facts ?? [];
}
