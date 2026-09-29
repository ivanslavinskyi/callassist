import type { SemanticDecision, SemanticInput } from "./live-semantic-gate";

/** Synthetic regression corpus shared by unit contract tests and the opt-in provider probe. */
export const semanticFixtures: Array<{ input: SemanticInput; expected: SemanticDecision }> = [
  { input: { kind: "speech", locale: "ru-RU", expected: "Elena, я звоню от имени Ivan. Вам удобно сейчас продолжить?",
    received: "Елена, я звоню от имени Иван. Вам удобно сейчас продолжить?" }, expected: "equivalent" },
  { input: { kind: "speech", locale: "en-GB", expected: "I am an AI assistant. May I record and automatically transcribe this call?",
    received: "I'm an AI assistant. Is it okay to record and automatically transcribe our conversation?" }, expected: "equivalent" },
  { input: { kind: "speech", locale: "en-GB", expected: "I am an AI assistant. May I record and automatically transcribe this call?",
    received: "I'm an AI assistant. May I record this call?" }, expected: "different" },
  { input: { kind: "speech", locale: "ru-RU", expected: "Elena, я звоню от имени Ivan. Вам удобно сейчас продолжить?",
    received: "Елена, я звоню" }, expected: "incomplete" },
  { input: { kind: "speech", locale: "en-GB", expected: "You proposed Monday at ten. Nothing is booked yet.",
    received: "Your appointment is confirmed for Monday at ten." }, expected: "different" }
];
