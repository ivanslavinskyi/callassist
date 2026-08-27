import { describe, expect, it } from "vitest";
import { DeterministicBriefCompiler, OpenAIBriefCompiler } from "./brief-compiler";
import { createBriefCompilerFromEnv } from "./create-brief-compiler";

describe("createBriefCompilerFromEnv", () => {
  it("uses the same configured compiler in API and worker processes", () => {
    expect(createBriefCompilerFromEnv({ BRIEF_COMPILER_DRIVER: "mock" }))
      .toBeInstanceOf(DeterministicBriefCompiler);
    expect(createBriefCompilerFromEnv({
      BRIEF_COMPILER_DRIVER: "openai",
      OPENAI_API_KEY: "test-key"
    })).toBeInstanceOf(OpenAIBriefCompiler);
  });

  it("fails startup when the selected OpenAI compiler has no key", () => {
    expect(() => createBriefCompilerFromEnv({
      BRIEF_COMPILER_DRIVER: "openai"
    })).toThrow("Missing required environment variable: OPENAI_API_KEY");
  });
});
