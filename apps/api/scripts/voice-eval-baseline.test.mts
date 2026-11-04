import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";

const voiceDir = resolve("src/voice");
const moduleUrl = (path: string) => JSON.stringify(pathToFileURL(resolve(path)).href);

it.each(["current", "head"] as const)("loads and calls both %s baseline prompts offline with their dependencies", async version => {
  const output = await mkdtemp(join(tmpdir(), "callassist-baseline-test-"));
  try {
    const source = async (name: string) => version === "current" ? readFile(join(voiceDir, name), "utf8") :
      execFileSync("git", ["show", `HEAD:apps/api/src/voice/${name}`], { encoding: "utf8" });
    let toolsSource = await source("live-managed-tools.ts");
    // A changed baseline binding must not silently resolve to the candidate module.
    if (version === "current") toolsSource = toolsSource.replace('export const RECIPIENT_ROLE_INSTRUCTIONS =',
      'export const RECIPIENT_ROLE_INSTRUCTIONS = "BASELINE_ROLE_SENTINEL"; const originalRoleInstructions =');
    await writeFile(join(output, "input.json"), JSON.stringify({ toolsSource,
      conversationSource: await source("live-conversation.ts"), output, voiceDir }));
    const result = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
      import { readFile } from 'node:fs/promises';
      import { loadBaselineVoiceModules } from ${moduleUrl("scripts/voice-eval-baseline.mts")};
      import { DeterministicBriefCompiler } from ${moduleUrl("src/brief-compiler/brief-compiler.ts")};
      import { normalizeCreateCallBriefInput, createApprovedExecutionSnapshot } from ${moduleUrl("../../packages/contracts/src/index.ts")};
      globalThis.fetch = () => { throw new Error('NETWORK_FORBIDDEN'); };
      const input = JSON.parse(await readFile(${JSON.stringify(join(output, "input.json"))}, 'utf8'));
      const raw = normalizeCreateCallBriefInput({ recipientName:'Test Desk',phoneNumber:'+41710000001',
        representedPersonFirstName:'Test',representedPersonLastName:'Patient',objective:'Ask opening hours',
        assistantProfileId:'sebastian',locale:'en-GB',allowedFacts:[] });
      const compilation = await new DeterministicBriefCompiler().compile(raw);
      compilation.approvedAt = '2026-11-04T00:00:00.000Z';
      const brief = { id:'11111111-1111-4111-8111-111111111111',voiceGender:'male',assistanceReason:'none',assistanceDisclosure:'',audioRetentionDays:0,
        allowLanguageSwitch:false,representedPerson:raw.representedPerson,recipientName:raw.recipientName };
      const snapshot = createApprovedExecutionSnapshot({ brief, compilation });
      const { backend, live } = await loadBaselineVoiceModules(input);
      const notes = backend.managedBackendInstructions(snapshot, brief, true);
      const speech = live.buildLiveInstructions({ brief, snapshot }, true);
      const tools = backend.liveManagedTools(snapshot, true, true);
      if (!notes.length || !speech.length || !tools.length) throw new Error('EMPTY_PROMPTS');
      if (${version === "current"} && (!notes.includes('BASELINE_ROLE_SENTINEL') || !speech.includes('BASELINE_ROLE_SENTINEL') ||
          !speech.includes('Information supplied by the user'))) throw new Error('BASELINE_BINDINGS_LOST');
      await loadBaselineVoiceModules(input);
      try { await loadBaselineVoiceModules({ ...input, toolsSource:input.toolsSource+'\\nexport const changed = true;' });
        throw new Error('SOURCE_CHANGE_ACCEPTED'); } catch(e) { if(e.message === 'SOURCE_CHANGE_ACCEPTED') throw e; }
      console.log('BASELINE_OK');
    `], { encoding: "utf8", timeout: 25_000 });
    expect(result).toContain("BASELINE_OK");
  } finally { await rm(output, { recursive: true, force: true }); }
}, 30_000);
