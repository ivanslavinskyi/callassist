import {
  DeterministicBriefCompiler,
  OpenAIBriefCompiler,
  type BriefCompiler
} from "./brief-compiler";

export function createBriefCompilerFromEnv(
  environment: NodeJS.ProcessEnv = process.env
): BriefCompiler {
  const configuredKey = environment.OPENAI_API_KEY?.trim();
  const driver = environment.BRIEF_COMPILER_DRIVER?.trim() ||
    (configuredKey ? "openai" : "mock");
  if (driver === "mock") return new DeterministicBriefCompiler();
  if (driver === "openai") {
    if (!configuredKey) {
      throw new Error("Missing required environment variable: OPENAI_API_KEY");
    }
    return new OpenAIBriefCompiler({
      apiKey: configuredKey,
      model: environment.OPENAI_BRIEF_COMPILER_MODEL,
      timeoutMs: parsePositiveInteger(
        environment.OPENAI_BRIEF_COMPILER_TIMEOUT_MS,
        "OPENAI_BRIEF_COMPILER_TIMEOUT_MS"
      ),
      requestTimeoutMs: parsePositiveInteger(
        environment.OPENAI_BRIEF_COMPILER_REQUEST_TIMEOUT_MS,
        "OPENAI_BRIEF_COMPILER_REQUEST_TIMEOUT_MS"
      )
    });
  }
  throw new Error(`Unsupported BRIEF_COMPILER_DRIVER: ${driver}`);
}

function parsePositiveInteger(value: string | undefined, name: string) {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}
