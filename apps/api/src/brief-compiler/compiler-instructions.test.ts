import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildCompilerInstructions } from "./compiler-instructions";

describe("pinned preparation instructions", () => {
  // Captured before replacing regex composition. Retries retain their original
  // policy text; changing behavior requires a separately versioned policy.
  it.each([
    ["legacy", "ed3cdc67709b02d713f65f4f2bfd2f1b6df891d2158d75bfd379e75195b0b642"],
    ["native", "12315435ea82c3f48d541a6c45aab85d0af70f4c4bb1f49c7128e5ef7162f97c"],
    ["native_actions", "102462522d436b843ded111fd59bde8707fb8543d3f3c0945065481f0e49576a"],
    ["native_progressive", "032021c9980320a60e4e3958dd39bfd55165f7475a916699fd8b1f8f11d7c5fe"]
  ] as const)("preserves the exact %s policy", (profile, hash) => {
    expect(createHash("sha256").update(buildCompilerInstructions(profile)).digest("hex")).toBe(hash);
  });
  it("keeps legacy consent/scheduling procedures out of native actions", () => {
    const instructions = buildCompilerInstructions("native_actions");
    expect(instructions).not.toContain("task stage after recording consent");
    expect(instructions).not.toContain("Always return the compiler-only schedulingInterpretation");
    expect(instructions).toContain("Return nativeAppointmentInterpretation");
    expect(instructions).toContain("Preserve all user facts");
  });
});
