"use client";

import {
  ASSISTANT_PROFILES,
  CALL_BRIEF_INPUT_LIMITS,
  SELECTABLE_CALL_LANGUAGES,
  callBriefTaskTextLength,
  formatPersonName,
  getAssistanceDisclosure,
  type AssistanceReason,
  type AssistantProfileId,
  type CallBrief,
  type CallLocale,
  type CreateCallBriefInput,
  type TaskLanguagePreferences
} from "@callassist/contracts";
import { useEffect, useMemo, useRef, useState, type FormEvent, type SetStateAction } from "react";
import {
  createCallBrief,
  getCallSnapshot,
  getCallPreparationErrorMessage
} from "@/lib/api";
import {
  getCallPreparationSessionStorage,
  prepareCallBriefCreation
} from "@/lib/call-preparation-attempt";
import { useUiLocale } from "./ui-locale-provider";
import { isE164PhoneNumber, normalizePhoneNumber } from "@/lib/phone-number";
import { designMessages } from "@/lib/i18n/design-messages";
import { RecipientCombobox } from "./recipient-combobox";
import { representedPersonDefaults, type ProfileName } from "@/lib/represented-person-defaults";
import { getCallLanguageLabel, languageMessages } from "@/lib/i18n/language-messages";
import { useCallDraftStore } from "./call-draft-provider";
import type { CallDraft } from "@/lib/call-draft-store";

const emptyForm: CreateCallBriefInput = {
  recipientName: "",
  phoneNumber: "",
  objective: "",
  assistantProfileId: "sebastian",
  representedPersonFirstName: "",
  representedPersonLastName: "",
  assistanceReason: "none",
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
  profileName?: ProfileName;
  initialValue?: CreateCallBriefInput;
  draftId?: string;
  initialLanguagePreferences?: TaskLanguagePreferences;
  saveCallBrief?: (
    input: CreateCallBriefInput,
    idempotencyKey?: string,
    languagePreferences?: TaskLanguagePreferences
  ) => Promise<CallBrief>;
  heading?: string;
  headingLevel?: 1 | 2;
  submitLabel?: string;
  onCancel?: () => void;
};

export function CreateCallForm({
  onCreated,
  userId,
  profileName,
  initialValue,
  draftId = "new",
  initialLanguagePreferences,
  saveCallBrief = createCallBrief,
  heading,
  headingLevel = 2,
  submitLabel,
  onCancel
}: CreateCallFormProps) {
  const { messages, locale: uiLocale } = useUiLocale();
  const design = designMessages[uiLocale];
  const Heading = headingLevel === 1 ? "h1" : "h2";
  const copy = messages.form.copy;
  const resolvedHeading = heading ?? copy.defaultHeading;
  const resolvedSubmitLabel = submitLabel ?? copy.reviewCall;
  const draftStore = useCallDraftStore();
  const owner = userId ?? "anonymous";
  const [draft, setDraft] = useState<CallDraft>(() => {
    const previous = draftStore.forOwner(owner).get(owner, draftId);
    if (previous) return previous;
    const initialForm = {
      ...emptyForm,
      ...initialValue,
      ...representedPersonDefaults(initialValue, profileName),
      allowedFacts: cleanLegacyDemoFacts(initialValue?.allowedFacts),
      clarificationAnswers: initialValue?.clarificationAnswers ?? []
    };
    // Preserve old snapshots; a newly compiled version uses the current voice choice.
    if (initialForm.locale === "en-US") initialForm.locale = "en-GB";
    if (initialForm.fallbackLocale === "en-US") initialForm.fallbackLocale = "en-GB";
    if (initialForm.fallbackLocale === initialForm.locale) {
      initialForm.allowLanguageSwitch = false;
      delete initialForm.fallbackLocale;
    }
    return {
      form: initialForm,
      factsText: cleanLegacyDemoFacts(initialValue?.allowedFacts).join("\n"),
      languagePreferences: initialLanguagePreferences ?? { mode: "auto", uiLocaleHint: uiLocale },
      preparationAttempt: null
    };
  });
  const draftRef = useRef(draft);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const { form, factsText, languagePreferences } = draft;
  const languageCopy = languageMessages[uiLocale];
  function updateDraft(patch: Partial<CallDraft>) {
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    draftStore.set(owner, draftId, next);
    if (mounted.current) setDraft(next);
  }
  function setForm(action: SetStateAction<CreateCallBriefInput>) {
    updateDraft({ form: typeof action === "function" ? action(draftRef.current.form) : action });
  }
  function setFactsText(value: string) { updateDraft({ factsText: value }); }
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fallbackLanguages = useMemo(
    () => SELECTABLE_CALL_LANGUAGES.filter(({ locale }) => locale !== form.locale),
    [form.locale]
  );
  const disclosurePreview = useMemo(
    () =>
      getAssistanceDisclosure(
        form.locale,
        form.assistanceReason ?? "none",
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
  const allowedFacts = useMemo(() => parseFactsText(factsText), [factsText]);
  const taskTextLength = useMemo(() => callBriefTaskTextLength({
    ...form,
    allowedFacts
  }), [allowedFacts, form]);
  const taskTextOverLimit =
    taskTextLength > CALL_BRIEF_INPUT_LIMITS.aggregateTaskTextHard;
  const taskTextNearLimit =
    taskTextLength > CALL_BRIEF_INPUT_LIMITS.aggregateTaskTextSoft;
  const factsInvalid =
    allowedFacts.length > CALL_BRIEF_INPUT_LIMITS.allowedFacts ||
    allowedFacts.some((fact) =>
      fact.length > CALL_BRIEF_INPUT_LIMITS.allowedFact
    );

  function update<Value extends keyof CreateCallBriefInput>(
    field: Value,
    value: CreateCallBriefInput[Value]
  ) {
    setForm((current) => {
      const next = { ...current, [field]: value };
      if (field === "locale" && next.fallbackLocale === next.locale) {
        next.fallbackLocale = SELECTABLE_CALL_LANGUAGES.find(({ locale }) => locale !== next.locale)?.locale;
      }
      return next;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const input = {
      ...form,
      phoneNumber: normalizePhoneNumber(form.phoneNumber),
      allowedFacts
    };
    if (taskTextOverLimit) {
      setError(messages.form.taskTextTooLong);
      setSubmitting(false);
      return;
    }
    if (factsInvalid) {
      setError(messages.form.factsTooLong);
      setSubmitting(false);
      return;
    }

    let brief: CallBrief;
    try {
      if (!userId) {
        brief = await saveCallBrief(input, undefined, languagePreferences);
      } else {
        const storage = getCallPreparationSessionStorage();
        brief = await prepareCallBriefCreation({
          input,
          languagePreferences,
          scope: draftId,
          userId,
          current: draftRef.current.preparationAttempt,
          storage,
          save: (value, idempotencyKey) =>
            saveCallBrief(value, idempotencyKey, languagePreferences),
          load: async (callBriefId) =>
            (await getCallSnapshot(callBriefId)).brief,
          onAttempt: (attempt) => {
            if (mounted.current) updateDraft({ preparationAttempt: attempt });
            else {
              const current = draftStore.get(owner, draftId);
              if (current?.preparationAttempt?.idempotencyKey === attempt.idempotencyKey) {
                draftStore.set(owner, draftId, { ...current, preparationAttempt: attempt });
              }
            }
          }
        });
      }
    } catch (error) {
      setError(getCallPreparationErrorMessage(error, {
        generic: messages.form.preparationError,
        unavailable: messages.form.preparationUnavailable,
        invalid: messages.form.preparationInvalid,
        notFound: messages.form.preparationNotFound,
        notEditable: messages.form.preparationNotEditable,
        swissDestinationRequired: messages.form.phoneInvalid,
        rateLimited: messages.form.rateLimited
      }));
      setSubmitting(false);
      return;
    }

    try {
      if (initialValue) draftStore.clear(owner, draftId);
      if (mounted.current) {
        onCreated(brief);
        draftStore.clear(owner, draftId);
      }
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
          <Heading>{resolvedHeading}</Heading>
          <p>{design.formLead}</p>
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
        <div className="form-section-title">{design.recipient}</div>
        <div className="field-wide"><RecipientCombobox
          enabled={Boolean(userId)}
          value={form.recipientName}
          onChange={(value) => update("recipientName", value)}
          onSelect={(suggestion) => setForm((current) => ({
            ...current,
            recipientName: suggestion.recipientName,
            phoneNumber: suggestion.phoneNumber
          }))}
        /></div>

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
              : design.phoneHint}
          </small>
        </label>

        <label className="field">
          <span>{copy.callLanguage}</span>
          <select
            value={form.locale}
            onChange={(event) => update("locale", event.target.value as CallLocale)}
          >
            {SELECTABLE_CALL_LANGUAGES.map(({ locale }) => (
              <option key={locale} value={locale}>{getCallLanguageLabel(locale, uiLocale)}</option>
            ))}
          </select>
          {initialValue?.locale === "en-US" || initialValue?.fallbackLocale === "en-US"
            ? <small>{languageCopy.legacyEnglish}</small> : null}
        </label>

        <div className="form-section-title">{design.task}</div>
        <label className="field field-wide objective-field">
          <span>{copy.objective}</span>
          <textarea
            value={form.objective}
            onChange={(event) => update("objective", event.target.value)}
            maxLength={CALL_BRIEF_INPUT_LIMITS.objective}
            placeholder={copy.objectivePlaceholder}
            rows={5}
            required
          />
          <small>
            {messages.form.characterCount(
              form.objective.length,
              CALL_BRIEF_INPUT_LIMITS.objective
            )}
          </small>
        </label>

        <div className="form-section-title">{design.assistant}</div>
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
            value={form.assistanceReason ?? "none"}
            onChange={(event) =>
              update("assistanceReason", event.target.value as AssistanceReason)
            }
          >
            <option value="none">{copy.noAssistanceDisclosure}</option>
            <option value="speech_impairment">{copy.speechImpairment}</option>
            <option value="language_barrier">{copy.languageBarrier}</option>
          </select>
          {(form.assistanceReason ?? "none") === "speech_impairment" ? (
            <small>{copy.assistanceDisclosureWarning}</small>
          ) : null}
        </label>

        <label className="field">
          <span>{copy.representedPersonFirstName}</span>
          <input
            value={form.representedPersonFirstName}
            onChange={(event) => update("representedPersonFirstName", event.target.value)}
            maxLength={CALL_BRIEF_INPUT_LIMITS.representedPersonNamePart}
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
            maxLength={CALL_BRIEF_INPUT_LIMITS.representedPersonNamePart}
            autoComplete="family-name"
            placeholder={copy.representedPersonLastNamePlaceholder}
            required
          />
        </label>
      </div>

      {!initialValue && profileName ? (
        <p className="call-options-help">{copy.profileNameHelp}</p>
      ) : null}

      <details className="call-options">
        <summary>
          <span>{messages.form.callOptions}</span>
          <span className="details-chevron" aria-hidden="true">⌄</span>
        </summary>
        <p className="call-options-help">{copy.objectiveHelp}</p>
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
                maxLength={CALL_BRIEF_INPUT_LIMITS.deliveryInstruction}
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
            {disclosurePreview ? (
              <>
                <span>{messages.form.disclosurePreview}</span>
                <blockquote>{disclosurePreview}</blockquote>
              </>
            ) : null}
            <small>{messages.form.disclosureHelp}</small>
          </div>

          <label className="field field-wide">
            <span>{copy.additionalContext}</span>
            <textarea
              value={form.context ?? ""}
              onChange={(event) => update("context", event.target.value)}
              maxLength={CALL_BRIEF_INPUT_LIMITS.context}
              rows={5}
              placeholder={copy.contextPlaceholder}
            />
            <small>{messages.form.characterCount(
              (form.context ?? "").length,
              CALL_BRIEF_INPUT_LIMITS.context
            )}</small>
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
                {fallbackLanguages.map(({ locale }) => (
                  <option key={locale} value={locale}>{getCallLanguageLabel(locale, uiLocale)}</option>
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
              maxLength={
                CALL_BRIEF_INPUT_LIMITS.allowedFact *
                  CALL_BRIEF_INPUT_LIMITS.allowedFacts +
                CALL_BRIEF_INPUT_LIMITS.allowedFacts - 1
              }
              rows={5}
              placeholder={copy.approvedInformationPlaceholder}
            />
            <small className={factsInvalid ? "field-invalid" : undefined}>
              {factsInvalid
                ? messages.form.factsTooLong
                : messages.form.factCount(
                    allowedFacts.length,
                    CALL_BRIEF_INPUT_LIMITS.allowedFacts
                  )}
            </small>
          </label>
        </div>
      </details>

      {error ? <p className="form-error">{error}</p> : null}

      <p
        className={taskTextOverLimit
          ? "field-invalid"
          : taskTextNearLimit ? "field-warning" : undefined}
        role={taskTextOverLimit ? "alert" : "status"}
      >
        {messages.form.taskTextBudget(
          taskTextLength,
          CALL_BRIEF_INPUT_LIMITS.aggregateTaskTextHard
        )}
      </p>

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
          <button className="secondary-button" disabled={submitting} onClick={() => { draftStore.clear(owner, draftId); onCancel(); }} type="button">
            {copy.cancel}
          </button>
        ) : null}
        <button
          className="primary-button"
          disabled={
            submitting ||
            requiredRemaining > 0 ||
            taskTextOverLimit ||
            factsInvalid
          }
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

function parseFactsText(value: string) {
  return value
    .split("\n")
    .map((fact) => fact.trim())
    .filter(Boolean);
}
