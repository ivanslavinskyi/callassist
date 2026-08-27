"use client";

import {
  ASSISTANT_PROFILES,
  SUPPORTED_CALL_LANGUAGES,
  formatPersonName,
  getAssistanceDisclosure,
  type AssistanceReason,
  type AssistantProfileId,
  type CallBrief,
  type CallLocale,
  type CreateCallBriefInput
} from "@callassist/contracts";
import { useMemo, useRef, useState, type FormEvent } from "react";
import {
  createCallBrief,
  getCallSnapshot,
  getCallPreparationErrorMessage
} from "@/lib/api";
import {
  getCallPreparationSessionStorage,
  prepareCallBriefCreation,
  type CallPreparationAttempt
} from "@/lib/call-preparation-attempt";
import { useUiLocale } from "./ui-locale-provider";
import { isE164PhoneNumber, normalizePhoneNumber } from "@/lib/phone-number";

const emptyForm: CreateCallBriefInput = {
  recipientName: "",
  phoneNumber: "",
  objective: "",
  assistantProfileId: "sebastian",
  representedPersonFirstName: "",
  representedPersonLastName: "",
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
  userId?: string;
  initialValue?: CreateCallBriefInput;
  saveCallBrief?: (
    input: CreateCallBriefInput,
    idempotencyKey?: string
  ) => Promise<CallBrief>;
  heading?: string;
  submitLabel?: string;
  onCancel?: () => void;
};

export function CreateCallForm({
  onCreated,
  userId,
  initialValue,
  saveCallBrief = createCallBrief,
  heading,
  submitLabel,
  onCancel
}: CreateCallFormProps) {
  const { messages } = useUiLocale();
  const copy = messages.form.copy;
  const resolvedHeading = heading ?? copy.defaultHeading;
  const resolvedSubmitLabel = submitLabel ?? copy.reviewCall;
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
  const preparationAttempt = useRef<CallPreparationAttempt | null>(null);

  const fallbackLanguages = useMemo(
    () => SUPPORTED_CALL_LANGUAGES.filter(({ locale }) => locale !== form.locale),
    [form.locale]
  );
  const disclosurePreview = useMemo(
    () =>
      getAssistanceDisclosure(
        form.locale,
        form.assistanceReason,
        formatPersonName(
          form.representedPersonFirstName,
          form.representedPersonLastName
        )
      ),
    [
      form.assistanceReason,
      form.locale,
      form.representedPersonFirstName,
      form.representedPersonLastName
    ]
  );
  const normalizedPhone = normalizePhoneNumber(form.phoneNumber);
  const phoneEntered = form.phoneNumber.trim().length > 0;
  const phoneValid = isE164PhoneNumber(normalizedPhone);
  const requiredComplete = [
    form.recipientName.trim().length >= 2,
    phoneValid,
    form.objective.trim().length >= 10,
    form.representedPersonFirstName.trim().length >= 1,
    form.representedPersonLastName.trim().length >= 1
  ];
  const completedRequiredCount = requiredComplete.filter(Boolean).length;
  const requiredRemaining = requiredComplete.length - completedRequiredCount;

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

    const input = {
      ...form,
      phoneNumber: normalizePhoneNumber(form.phoneNumber),
      allowedFacts: factsText
        .split("\n")
        .map((fact) => fact.trim())
        .filter(Boolean)
    };

    let brief: CallBrief;
    try {
      if (initialValue || !userId) {
        brief = await saveCallBrief(input);
      } else {
        const storage = getCallPreparationSessionStorage();
        brief = await prepareCallBriefCreation({
          input,
          userId,
          current: preparationAttempt.current,
          storage,
          save: (value, idempotencyKey) =>
            saveCallBrief(value, idempotencyKey),
          load: async (callBriefId) =>
            (await getCallSnapshot(callBriefId)).brief,
          onAttempt: (attempt) => {
            preparationAttempt.current = attempt;
          }
        });
      }
    } catch (error) {
      setError(getCallPreparationErrorMessage(error, {
        rateLimited: messages.form.rateLimited
      }));
      setSubmitting(false);
      return;
    }

    try {
      onCreated(brief);
    } catch {
      setError(messages.form.navigationError);
    }
    setSubmitting(false);
  }

  return (
    <form className="call-form" onSubmit={handleSubmit}>
      <div className="form-heading">
        <div>
          <span className="eyebrow">{initialValue ? copy.editBrief : copy.newBrief}</span>
          <h2>{resolvedHeading}</h2>
        </div>
        <span className="mode-badge">{copy.aiCall}</span>
      </div>

      <div className="required-progress">
        <div>
          <span>
            {requiredRemaining === 0
              ? messages.form.requiredComplete
              : messages.form.requiredRemaining(requiredRemaining)}
          </span>
          <strong>{completedRequiredCount}/{requiredComplete.length}</strong>
        </div>
        <progress
          aria-label={requiredRemaining === 0
            ? messages.form.requiredComplete
            : messages.form.requiredRemaining(requiredRemaining)}
          max={requiredComplete.length}
          value={completedRequiredCount}
        />
      </div>

      <div className="form-grid">
        <label className="field field-wide">
          <span>{copy.recipient}</span>
          <input
            value={form.recipientName}
            onChange={(event) => update("recipientName", event.target.value)}
            placeholder={copy.recipientPlaceholder}
            required
          />
        </label>

        <label className="field">
          <span>{copy.phone}</span>
          <input
            value={form.phoneNumber}
            onChange={(event) => update("phoneNumber", event.target.value)}
            onBlur={() => update("phoneNumber", normalizedPhone)}
            placeholder="+41..."
            inputMode="tel"
            aria-invalid={phoneEntered ? !phoneValid : undefined}
            required
          />
          <small className={phoneEntered ? (phoneValid ? "field-valid" : "field-invalid") : ""}>
            {phoneEntered
              ? (phoneValid ? messages.form.phoneValid : messages.form.phoneInvalid)
              : messages.form.phoneInvalid}
          </small>
        </label>

        <label className="field">
          <span>{copy.callLanguage}</span>
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
          <span>{copy.objective}</span>
          <textarea
            value={form.objective}
            onChange={(event) => update("objective", event.target.value)}
            placeholder={copy.objectivePlaceholder}
            rows={5}
            required
          />
          <small>{copy.objectiveHelp}</small>
        </label>

        <label className="field">
          <span>{copy.assistant}</span>
          <select
            value={form.assistantProfileId}
            onChange={(event) =>
              update("assistantProfileId", event.target.value as AssistantProfileId)
            }
          >
            <optgroup label={copy.maleVoice}>
              {ASSISTANT_PROFILES.filter(({ voiceGender }) => voiceGender === "male").map(
                ({ id, displayName }) => <option key={id} value={id}>{displayName}</option>
              )}
            </optgroup>
            <optgroup label={copy.femaleVoice}>
              {ASSISTANT_PROFILES.filter(({ voiceGender }) => voiceGender === "female").map(
                ({ id, displayName }) => <option key={id} value={id}>{displayName}</option>
              )}
            </optgroup>
          </select>
        </label>

        <label className="field">
          <span>{copy.assistanceReason}</span>
          <select
            value={form.assistanceReason}
            onChange={(event) =>
              update("assistanceReason", event.target.value as AssistanceReason)
            }
          >
            <option value="speech_impairment">{copy.speechImpairment}</option>
            <option value="language_barrier">{copy.languageBarrier}</option>
          </select>
        </label>

        <label className="field">
          <span>{copy.representedPersonFirstName}</span>
          <input
            value={form.representedPersonFirstName}
            onChange={(event) => update("representedPersonFirstName", event.target.value)}
            autoComplete="given-name"
            placeholder={copy.representedPersonFirstNamePlaceholder}
            required
          />
        </label>

        <label className="field">
          <span>{copy.representedPersonLastName}</span>
          <input
            value={form.representedPersonLastName}
            onChange={(event) => update("representedPersonLastName", event.target.value)}
            autoComplete="family-name"
            placeholder={copy.representedPersonLastNamePlaceholder}
            required
          />
        </label>
      </div>

      <details className="call-options">
        <summary>
          <span>{messages.form.callOptions}</span>
          <span className="details-chevron" aria-hidden="true">⌄</span>
        </summary>
        <p>{copy.optionsHelp}</p>

        <div className="form-grid call-options-grid">
          <label className="field">
            <span>{copy.result}</span>
            <select
              value={form.resultHandling ?? "capture_in_callassist"}
              onChange={(event) =>
                update(
                  "resultHandling",
                  event.target.value as NonNullable<CreateCallBriefInput["resultHandling"]>
                )
              }
            >
              <option value="capture_in_callassist">{copy.captureResult}</option>
              <option value="request_external_delivery">{copy.externalDelivery}</option>
              <option value="message_only">{copy.messageOnly}</option>
            </select>
          </label>

          <label className="field">
            <span>{copy.addressing}</span>
            <select
              value={form.addressingMode ?? "formal"}
              onChange={(event) =>
                update(
                  "addressingMode",
                  event.target.value as NonNullable<CreateCallBriefInput["addressingMode"]>
                )
              }
            >
              <option value="formal">{copy.formalDefault}</option>
              <option value="auto">{copy.automaticRelationship}</option>
              <option value="informal">{copy.informal}</option>
            </select>
          </label>

          <label className="field">
            <span>{copy.tone}</span>
            <select
              value={form.tonePreference ?? "auto"}
              onChange={(event) =>
                update(
                  "tonePreference",
                  event.target.value as NonNullable<CreateCallBriefInput["tonePreference"]>
                )
              }
            >
              <option value="auto">{copy.automatic}</option>
              <option value="formal">{copy.formal}</option>
              <option value="neutral">{copy.neutral}</option>
              <option value="friendly">{copy.friendly}</option>
            </select>
          </label>

          <label className="field">
            <span>{copy.voicemail}</span>
            <select
              value={form.voicemailPolicy ?? "do_not_leave_details"}
              onChange={(event) =>
                update(
                  "voicemailPolicy",
                  event.target.value as NonNullable<CreateCallBriefInput["voicemailPolicy"]>
                )
              }
            >
              <option value="do_not_leave_details">{copy.noCallDetails}</option>
              <option value="leave_neutral_message">{copy.neutralMessage}</option>
            </select>
          </label>

          {form.resultHandling === "request_external_delivery" ? (
            <label className="field field-wide">
              <span>{copy.deliveryInstruction}</span>
              <input
                value={form.deliveryInstruction ?? ""}
                onChange={(event) => update("deliveryInstruction", event.target.value)}
                placeholder={copy.deliveryPlaceholder}
              />
            </label>
          ) : null}

          <label className="field">
            <span>{copy.audioRetention}</span>
            <select
              value={form.audioRetentionDays ?? 7}
              onChange={(event) =>
                update("audioRetentionDays", Number(event.target.value) as 0 | 7 | 30)
              }
            >
              <option value={0}>{copy.deleteAfterTranscript}</option>
              <option value={7}>{copy.keepSevenDays}</option>
              <option value={30}>{copy.keepThirtyDays}</option>
            </select>
          </label>

          <div className="field field-wide disclosure-preview">
            <span>{messages.form.disclosurePreview}</span>
            <blockquote>{disclosurePreview}</blockquote>
            <small>{messages.form.disclosureHelp}</small>
          </div>

          <label className="field field-wide">
            <span>{copy.additionalContext}</span>
            <textarea
              value={form.context ?? ""}
              onChange={(event) => update("context", event.target.value)}
              rows={5}
              placeholder={copy.contextPlaceholder}
            />
          </label>
        </div>

        <div className="language-policy">
          <label className="switch-row">
            <input
              type="checkbox"
              role="switch"
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
              <strong>{copy.allowLanguageSwitching}</strong>
              <small>{copy.languageSwitchHelp}</small>
            </span>
          </label>

          {form.allowLanguageSwitch ? (
            <label className="field fallback-field">
              <span>{copy.fallbackLanguage}</span>
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
            <span className="section-label">{copy.shareableInformation}</span>
            <p>{copy.shareableInformationHelp}</p>
          </div>
          <label className="field field-wide">
            <span>{copy.approvedInformation}</span>
            <textarea
              value={factsText}
              onChange={(event) => setFactsText(event.target.value)}
              rows={5}
              placeholder={copy.approvedInformationPlaceholder}
            />
          </label>
        </div>
      </details>

      {error ? <p className="form-error">{error}</p> : null}

      {submitting ? (
        <div className="compilation-progress" role="status" aria-live="polite">
          <span className="processing-spinner" aria-hidden="true" />
          <div>
            <strong>{messages.form.preparingTitle}</strong>
            <p>{messages.form.preparingText}</p>
          </div>
        </div>
      ) : null}

      <div className="form-actions sticky-form-actions">
        {onCancel ? (
          <button className="secondary-button" onClick={onCancel} type="button">
            {copy.cancel}
          </button>
        ) : null}
        <button
          className="primary-button"
          disabled={submitting || requiredRemaining > 0}
          type="submit"
        >
          <span>{submitting ? copy.preparing : resolvedSubmitLabel}</span>
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
