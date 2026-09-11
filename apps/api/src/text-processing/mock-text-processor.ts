import {
  TEXT_PROCESSOR_VERSION,
  TextProcessingError,
  type TextProcessingInput,
  type TextProcessingRunOptions,
  type TextProcessor
} from "./text-processor";
import { validateTextProcessingInput, validateTextProcessingOutput } from "./text-validation";

export class MockTextProcessor implements TextProcessor {
  readonly driver = "mock" as const;
  readonly model = "mock-text-fixtures";
  readonly generatorVersion = `${TEXT_PROCESSOR_VERSION}:mock`;
  readonly #fixture?: (input: TextProcessingInput) => unknown;

  constructor(options: { fixture?: (input: TextProcessingInput) => unknown } = {}) {
    this.#fixture = options.fixture;
  }

  async process(input: TextProcessingInput, options: TextProcessingRunOptions = {}) {
    validateTextProcessingInput(input);
    if (options.signal?.aborted) throw new TextProcessingError("TEXT_REQUEST_FAILED");
    const prefix = `[MOCK ${input.targetLanguage}: untranslated source] `;
    const output = this.#fixture ? this.#fixture(structuredClone(input)) :
      input.kind === "plan_review" || input.kind === "clarification_review"
        ? { fields: input.fields.map((field) => ({ id: field.id, text: prefix + field.text })) }
        : input.kind === "transcript_translation"
          ? { segments: input.segments.map((segment) => ({ id: segment.id, text: prefix + segment.text })) }
          : input.extraction ? { ...input.extraction, overview: [] }
          : { schemaVersion: 2, overview: [], findings: input.checks.map(check => ({
            id: check.id, label: prefix + "Result",
            text: "[MOCK: no factual summary has been generated]", certainty: "unknown", sourceSegmentIds: []
          })), nextSteps: [], unresolved: ["[MOCK: no factual summary has been generated]"] };
    return validateTextProcessingOutput(input, output);
  }
}
