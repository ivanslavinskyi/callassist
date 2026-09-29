import { describe, expect, it } from "vitest";
import { isTranscriptionBudgetBlocked, transcriptionBudgetMessages } from "./i18n/transcription-budget";
import { uiLocales } from "./i18n/registry";

describe("transcription waiting state", () => {
  it.each(["BETA_BUDGET_EXHAUSTED", "BETA_BUDGET_UNCONFIGURED", "BETA_SPENDING_PAUSED"])("recognizes %s as deferred admission", reason => {
    expect(isTranscriptionBudgetBlocked(reason)).toBe(true);
  });
  it.each([null, undefined, "POST_CALL_TRANSCRIPTION_FAILED", "OPENAI_REQUEST_FAILED", "AUDIO_EMPTY"])("preserves the normal failure state for %s", reason => {
    expect(isTranscriptionBudgetBlocked(reason)).toBe(false);
  });
  it.each(uiLocales)("provides waiting and retention copy for %s", locale => {
    expect(transcriptionBudgetMessages[locale].title.length).toBeGreaterThan(5);
    expect(transcriptionBudgetMessages[locale].help.length).toBeGreaterThan(40);
    if (locale !== "en") expect(transcriptionBudgetMessages[locale].help).not.toBe(transcriptionBudgetMessages.en.help);
  });
});
