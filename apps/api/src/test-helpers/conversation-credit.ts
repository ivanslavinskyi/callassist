import type { CallRepository } from "../storage/call-repository";
import type { ConversationCreditEvidence } from "@callassist/contracts";

/** Creates persisted, post-consent evidence; does not run a model or settle credit. */
export async function conversationCreditFixture(repository: CallRepository, id: string): Promise<ConversationCreditEvidence> {
  const begun = await repository.beginRecording(id);
  await repository.attachProviderRecording(begun.recording.id, `RE-${begun.recording.id}`, "in-progress");
  const question = await repository.addTranscript(id, "assistant", "Has the application arrived?", "en-GB");
  const answer = await repository.addTranscript(id, "recipient", "Yes, the application arrived yesterday.", "en-GB");
  return { version: 1, questionSegmentId: question.segment.id, answerSegmentId: answer.segment.id, category: "task_answer" };
}
