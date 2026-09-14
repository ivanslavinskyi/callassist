import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { TranscriptSegment } from "@callassist/contracts";
import { parseConversationCreditDecision } from "./conversation-credit-classifier";

const segment = (role: TranscriptSegment["role"], text: string): TranscriptSegment => ({
  id: randomUUID(), role, text, locale: "en-GB", final: true, createdAt: new Date().toISOString()
});
const question = segment("assistant", "Has the application arrived?");
const output = (category: string, answerQuote: string) => [{ type: "function_call", name: "classify_task_answer", arguments: JSON.stringify({ category, answerQuote }) }];

describe("conversation credit decision boundary", () => {
  it.each(["Yes, it arrived.", "Ja, der Antrag ist angekommen.", "Oui, il est arrivé.", "Sì, è arrivata.", "Так, заяву отримали.", "Да, заявление получено."])("keeps the evidence in its original language: %s", text => {
    const answer = segment("recipient", text);
    expect(parseConversationCreditDecision(output("task_answer", text), question, answer)).toEqual({
      version: 1, questionSegmentId: question.id, answerSegmentId: answer.id, category: "task_answer"
    });
  });
  it.each(["not_substantive", "uncertain", "unknown"])("never charges a %s decision", category => {
    expect(parseConversationCreditDecision(output(category, "Hello"), question, segment("recipient", "Hello"))).toBeNull();
  });
  it("rejects invented quotes, assistant-only evidence, extra fields and multiple tools", () => {
    const answer = segment("recipient", "I do not know.");
    expect(parseConversationCreditDecision(output("task_answer", "It arrived"), question, answer)).toBeNull();
    expect(parseConversationCreditDecision(output("task_answer", "I do not know."), question, { ...answer, role: "assistant" })).toBeNull();
    expect(parseConversationCreditDecision([{ type: "function_call", name: "classify_task_answer", arguments: '{"category":"task_answer","answerQuote":"I do not know.","charge":true}' }], question, answer)).toBeNull();
    expect(parseConversationCreditDecision([...output("cannot_answer", answer.text), ...output("cannot_answer", answer.text)], question, answer)).toBeNull();
  });
});
