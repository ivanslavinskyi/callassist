import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

/** Prompt-only baseline: preserve module dependencies; never instantiate a call runtime. */
export async function loadBaselineVoiceModules(input: {
  toolsSource: string; conversationSource: string; output: string; voiceDir: string;
}) {
  const toolsPath = resolve(input.output, "baseline-tools.mjs");
  async function load(name: string, source: string) {
    const relocated = source.replace(/from\s+(["'])([^"']+)\1/g, (_all, _quote: string, specifier: string) => {
      const target = specifier === "./live-managed-tools" ? pathToFileURL(toolsPath).href :
        specifier.startsWith(".") ? pathToFileURL(resolve(input.voiceDir, specifier + ".ts")).href :
        import.meta.resolve(specifier);
      return `from ${JSON.stringify(target)}`;
    });
    const js = ts.transpileModule(relocated, { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext
    } }).outputText;
    const path = resolve(input.output, name);
    try { await writeFile(path, js, { flag: "wx" }); }
    catch (error: any) { if (error.code !== "EEXIST" || await readFile(path, "utf8") !== js) throw error; }
    return import(pathToFileURL(path).href);
  }
  const backend = await load("baseline-tools.mjs", input.toolsSource);
  const live = await load("baseline-live-prompt.mjs", input.conversationSource);
  if (typeof backend.managedBackendInstructions !== "function" || typeof backend.liveManagedTools !== "function" ||
      typeof live.buildLiveInstructions !== "function") throw new Error("BASELINE_PROMPT_NOT_FOUND");
  return { backend, live };
}
