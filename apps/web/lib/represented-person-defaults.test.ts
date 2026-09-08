import { describe, expect, it } from "vitest";
import type { CreateCallBriefInput } from "@callassist/contracts";
import { representedPersonDefaults } from "./represented-person-defaults";

describe("represented person defaults", () => {
  const profile = { firstName: "Zoë", lastName: "Мельник" };
  it("uses the current profile only for a new plan", () => {
    expect(representedPersonDefaults(undefined, profile)).toEqual({
      representedPersonFirstName: "Zoë", representedPersonLastName: "Мельник"
    });
  });
  it.each(["Other person", ""])("preserves stored or manually edited values (%s)", firstName => {
    const stored = { representedPersonFirstName: firstName, representedPersonLastName: "Different" } as CreateCallBriefInput;
    expect(representedPersonDefaults(stored, profile)).toEqual(stored);
    expect(profile).toEqual({ firstName: "Zoë", lastName: "Мельник" });
  });
  it("leaves missing names editable and subject to existing validation", () => {
    expect(representedPersonDefaults()).toEqual({ representedPersonFirstName: "", representedPersonLastName: "" });
  });
});
