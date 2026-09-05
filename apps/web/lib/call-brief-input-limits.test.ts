import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const createForm = source("../components/create-call-form.tsx");
const clarificationForm = source("../components/compilation-review.tsx");
const recipientCombobox = source("../components/recipient-combobox.tsx");

describe("call brief input limits", () => {
  it("binds visible fields to the shared contract constants", () => {
    for (const limit of [
      "objective",
      "context",
      "deliveryInstruction",
      "representedPersonNamePart",
      "allowedFact",
      "allowedFacts"
    ]) {
      expect(createForm).toContain(`CALL_BRIEF_INPUT_LIMITS.${limit}`);
    }
    expect(recipientCombobox).toContain(
      "CALL_BRIEF_INPUT_LIMITS.recipientName"
    );
    expect(clarificationForm).toContain(
      "CALL_BRIEF_INPUT_LIMITS.clarificationAnswer"
    );
  });

  it("uses the contract aggregate counter and blocks oversized submissions", () => {
    expect(createForm).toContain("callBriefTaskTextLength");
    expect(createForm).toContain(
      "CALL_BRIEF_INPUT_LIMITS.aggregateTaskTextHard"
    );
    expect(createForm).toContain("taskTextOverLimit ||");
    expect(clarificationForm).toContain("callBriefTaskTextLength");
    expect(clarificationForm).toContain("!complete || taskTextOverLimit");
  });
});

function source(relativePath: string) {
  return readFileSync(fileURLToPath(
    new URL(relativePath, import.meta.url)
  ), "utf8");
}
