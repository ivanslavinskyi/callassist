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
      if (!Array.isArray(input.questions) || input.questions.length > 30 ||
        input.questions.some((question) => !nonempty(question, 4000))) {
        throw new TextProcessingError("TEXT_INPUT_INVALID");
      }
      characterCount += input.questions.reduce((sum, question) => sum + question.length, 0);
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
  keys(payload, ["answers", "nextSteps", "unresolved"]);
  if (!Array.isArray(payload.answers) || payload.answers.length !== input.questions.length ||
    !Array.isArray(payload.nextSteps) || payload.nextSteps.length > 30 ||
    !Array.isArray(payload.unresolved) || payload.unresolved.length > 30 ||
    payload.unresolved.some((item) => !nonempty(item, 4000))) invalid();
  const sourceIds = new Set(input.segments.map((segment) => segment.id));
  const sourceTexts = new Map(input.segments.map((segment) => [segment.id, segment.text]));
  const references = (value: unknown, required: boolean): string[] => {
    if (!Array.isArray(value) || value.length > 30 || (required && value.length === 0) ||
      value.some((id) => typeof id !== "string" || !sourceIds.has(id)) ||
      new Set(value).size !== value.length) invalid();
    return value as string[];
  };
  const answers = payload.answers.map((entry, index) => {
    const answer = record(entry);
    keys(answer, ["questionId", "question", "answer", "certainty", "sourceSegmentIds"]);
    if (answer.questionId !== `question.${index}` || !nonempty(answer.question, 4000) ||
      !nonempty(answer.answer, 8000) ||
      !["reported", "conditional", "unknown"].includes(String(answer.certainty))) invalid();
    const citedIds = references(answer.sourceSegmentIds, answer.certainty !== "unknown");
    assertGroundedIdentifiers(answer.question as string, input.questions[index]!);
    assertGroundedIdentifiers(answer.answer as string, [input.questions[index]!, ...citedIds.map((id) => sourceTexts.get(id)!)].join("\n"));
    return {
      question: answer.question as string,
      answer: answer.answer as string,
      certainty: answer.certainty as "reported" | "conditional" | "unknown",
      sourceSegmentIds: citedIds
    };
  });
  const nextSteps = payload.nextSteps.map((entry) => {
    const step = record(entry);
    keys(step, ["text", "sourceSegmentIds"]);
    if (!nonempty(step.text, 4000)) invalid();
    const citedIds = references(step.sourceSegmentIds, true);
    assertGroundedIdentifiers(step.text as string, citedIds.map((id) => sourceTexts.get(id)!).join("\n"));
    return { text: step.text as string, sourceSegmentIds: citedIds };
  });
  const fullSource = [...input.questions, ...input.segments.map((segment) => segment.text)].join("\n");
  for (const item of payload.unresolved) assertGroundedIdentifiers(item as string, fullSource);
  return callSummaryPayloadSchema.parse({ answers, nextSteps, unresolved: payload.unresolved });
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
    answers: { type: "array", items: object({
      questionId: text, question: text, answer: text,
      certainty: { type: "string", enum: ["reported", "conditional", "unknown"] },
      sourceSegmentIds: stringList
    }) },
    nextSteps: { type: "array", items: object({ text, sourceSegmentIds: stringList }) },
    unresolved: stringList
  });
}

export function providerTextInput(input: TextProcessingInput) {
  if (input.kind !== "call_summary") return input;
  return { ...input, questions: input.questions.map((text, index) => ({ id: `question.${index}`, text })) };
}
