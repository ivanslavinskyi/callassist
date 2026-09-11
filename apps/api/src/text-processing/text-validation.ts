import {
  callSummaryPayloadSchema,
  planReviewPayloadSchema,
  sourceSegmentSchema,
  textLanguageSchema,
  transcriptTranslationPayloadSchema
} from "@callassist/contracts";
import { protectedIdentifiers } from "../brief-compiler/brief-compiler";
import {
  MAX_TEXT_PROCESSING_SOURCE_CHARACTERS,
  TextProcessingError,
  type TextProcessingInput,
  type TextProcessingPayload
} from "./text-processor";

type JsonRecord = Record<string, unknown>;
function record(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as JsonRecord;
}
function invalid(): never { throw new TextProcessingError("TEXT_RESPONSE_INVALID"); }
function keys(value: JsonRecord, expected: string[]) {
  if (Object.keys(value).length !== expected.length || expected.some((key) => !(key in value))) invalid();
}
function nonempty(value: unknown, maximum = 24_000): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

export function validateTextProcessingInput(input: TextProcessingInput): void {
  let characterCount = 0;
  if (!textLanguageSchema.safeParse(input.targetLanguage).success) {
    throw new TextProcessingError("TEXT_INPUT_INVALID");
  }
  if (input.kind === "plan_review" || input.kind === "clarification_review") {
    if (!Array.isArray(input.fields) || input.fields.length > 250 ||
      input.fields.some((field) => !nonempty(field.id, 200) || !nonempty(field.text)) ||
      new Set(input.fields.map((field) => field.id)).size !== input.fields.length) {
      throw new TextProcessingError("TEXT_INPUT_INVALID");
    }
    characterCount = input.fields.reduce((sum, field) => sum + field.id.length + field.text.length, 0);
  } else if (input.kind === "transcript_translation" || input.kind === "call_summary") {
    if (!Array.isArray(input.segments) || input.segments.length > 1000 ||
      input.segments.some((segment) => !sourceSegmentSchema.safeParse(segment).success ||
        (segment.startSeconds !== null && segment.endSeconds !== null && segment.endSeconds < segment.startSeconds)) ||
      new Set(input.segments.map((segment) => segment.id)).size !== input.segments.length) {
      throw new TextProcessingError("TEXT_INPUT_INVALID");
    }
    characterCount = input.segments.reduce((sum, segment) => sum + segment.id.length + segment.text.length, 0);
    if (input.kind === "call_summary") {
      if (!Array.isArray(input.checks) || input.checks.length > 30 || !input.checks.length ||
        input.checks.some(check => !nonempty(check.id, 160) || !nonempty(check.text, 12000)) ||
        new Set(input.checks.map(check => check.id)).size !== input.checks.length ||
        !input.context || [input.context.objective, input.context.taskType, input.context.recipient, input.context.representedPerson].some(value => !nonempty(value, 12000)) ||
        (input.extraction && !callSummaryPayloadSchema.safeParse(input.extraction).success)) {
        throw new TextProcessingError("TEXT_INPUT_INVALID");
      }
      characterCount += input.checks.reduce((sum, check) => sum + check.id.length + check.text.length, 0) +
        JSON.stringify(input.context).length + (input.extraction ? JSON.stringify(input.extraction).length : 0);
    }
  } else {
    throw new TextProcessingError("TEXT_INPUT_INVALID");
  }
  if (characterCount > MAX_TEXT_PROCESSING_SOURCE_CHARACTERS) {
    throw new TextProcessingError("TEXT_INPUT_TOO_LARGE");
  }
}

/** The provider only returns translated text; roles, timing and ordering are local. */
export function validateTextProcessingOutput(
  input: TextProcessingInput,
  value: unknown
): TextProcessingPayload {
  const payload = record(value);
  if (input.kind === "plan_review" || input.kind === "clarification_review") {
    keys(payload, ["fields"]);
    const translated = orderedTranslations(payload.fields, input.fields);
    return planReviewPayloadSchema.parse({ fields: translated });
  }
  if (input.kind === "transcript_translation") {
    keys(payload, ["segments"]);
    const translated = orderedTranslations(payload.segments, input.segments);
    const segments = input.segments.map((segment, index) => ({ ...segment, text: translated[index]!.text }));
    return transcriptTranslationPayloadSchema.parse({ segments, text: segments.map((segment) => segment.text).join("\n") });
  }
  if (input.kind !== "call_summary") invalid();
  const parsed = callSummaryPayloadSchema.safeParse(payload);
  if (!parsed.success || parsed.data.findings.length !== input.checks.length) invalid();
  const summary = parsed.data;
  if (input.extraction && ["findings", "nextSteps", "unresolved"].some(key =>
    JSON.stringify(summary[key as keyof typeof summary]) !== JSON.stringify(input.extraction![key as keyof typeof summary]))) invalid();
  const sourceIds = new Set(input.segments.map((segment) => segment.id));
  const sourceTexts = new Map(input.segments.map((segment) => [segment.id, segment.text]));
  const evidence = (ids: string[]) => {
    if (ids.some(id => !sourceIds.has(id))) invalid();
    return ids.map(id => sourceTexts.get(id)!).join("\n");
  };
  for (const [index, finding] of summary.findings.entries()) {
    if (finding.id !== input.checks[index]!.id) invalid();
    const cited = evidence(finding.sourceSegmentIds);
    const unknownContext = finding.certainty === "unknown" ? input.checks[index]!.text : "";
    assertGroundedIdentifiers(`${finding.label}\n${finding.text}`, `${cited}\n${unknownContext}`);
  }
  for (const item of summary.overview) {
    const findings = summary.findings.filter(finding => item.findingIds.includes(finding.id));
    const cited = evidence([...new Set(findings.flatMap(finding => finding.sourceSegmentIds))]);
    // A shortened result must retain the same evidence boundary as its detailed findings.
    assertGroundedIdentifiers(`${item.label ?? ""}\n${item.text}`, cited);
  }
  for (const step of summary.nextSteps) assertGroundedIdentifiers(step.text, evidence(step.sourceSegmentIds));
  const fullSource = [...input.checks.map(check => check.text), ...input.segments.map(segment => segment.text)].join("\n");
  for (const item of summary.unresolved) assertGroundedIdentifiers(item, fullSource);
  return summary;
}

function orderedTranslations(value: unknown, source: Array<{ id: string; text: string }>) {
  if (!Array.isArray(value) || value.length !== source.length) invalid();
  return value.map((entry, index) => {
    const item = record(entry);
    keys(item, ["id", "text"]);
    if (item.id !== source[index]!.id || !nonempty(item.text)) invalid();
    const sourceText = source[index]!.text;
    const translatedText = item.text as string;
    if (protectedIdentifiers(sourceText).some((identifier) => !translatedText.includes(identifier)) ||
      protectedIdentifiers(translatedText).some((identifier) => !sourceText.includes(identifier))) invalid();
    assertGroundedIdentifiers(translatedText, sourceText);
    assertGroundedIdentifiers(sourceText, translatedText);
    return { id: source[index]!.id, text: item.text as string };
  });
}

/** A citation is insufficient if the generated amount/date/identifier does not occur in its evidence. */
function assertGroundedIdentifiers(text: string, evidence: string) {
  const numbers = (value: string) => value.match(/\d+(?:[.,:/-]\d+)*/g) ?? [];
  const sourceNumbers = new Set(numbers(evidence));
  if (numbers(text).some((number) => !sourceNumbers.has(number)) ||
    protectedIdentifiers(text).some((identifier) => !evidence.includes(identifier))) invalid();
}

const text = { type: "string" };
const stringList = { type: "array", items: text };
function object(properties: JsonRecord) {
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}
const translatedItems = { type: "array", items: object({ id: text, text }) };
export function textOutputJsonSchema(input: TextProcessingInput) {
  if (input.kind === "plan_review" || input.kind === "clarification_review") return object({ fields: translatedItems });
  if (input.kind === "transcript_translation") return object({ segments: translatedItems });
  return object({
    schemaVersion: { type: "integer", enum: [2] },
    overview: { type: "array", items: object({ label: { type: ["string", "null"] }, text, findingIds: stringList }) },
    findings: { type: "array", items: object({
      id: text, label: text, text,
      certainty: { type: "string", enum: ["reported", "conditional", "unknown"] },
      sourceSegmentIds: stringList
    }) },
    nextSteps: { type: "array", items: object({ text, sourceSegmentIds: stringList }) },
    unresolved: stringList
  });
}

export function providerTextInput(input: TextProcessingInput) {
  return input;
}
