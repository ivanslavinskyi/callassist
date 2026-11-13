import { describe, expect, it } from "vitest";
import { defaultPreparationRuntimePolicy } from "@callassist/contracts";
import { selectedRuntimeProfile, voiceAgentHangupEnabled, runtimeProfiles } from "./runtime-profile";
import { voiceRuntimeMode, voiceRuntimeDriver } from "./voice-runtime";
import { assertRuntimeProfileReady } from "../runtime/runtime-profile-readiness";
import { InMemoryCallRepository } from "../storage/in-memory-call-repository";
import { DeterministicBriefCompiler } from "../brief-compiler/brief-compiler";
import { normalizeCreateCallBriefInput } from "@callassist/contracts";
import { NATIVE_CONFIGURATION_VERSION } from "../voice/live-native-configuration";

describe("explicit runtime profiles", () => {
  it("pins the role-fidelity release and requires an explicit transition from the previous native policy", async () => {
    expect(runtimeProfiles.native_v2).toMatchObject({
      promptVersion: "preparation-live-holistic-2026-11-13-v2",
      compilerVersion: "brief-compiler-17", planSchemaVersion: "11",
      runtimeVersion: NATIVE_CONFIGURATION_VERSION
    });
    const previous = new InMemoryCallRepository({ preparationPromptVersion: "preparation-live-native-integrity-2026-11-08" });
    const before = await previous.getPreparationSettings();
    await expect(assertRuntimeProfileReady(previous, { CALL_RUNTIME_PROFILE: "native_v2" })).rejects.toThrow("RUNTIME_PROFILE_MISMATCH");
    expect(await previous.getPreparationSettings()).toEqual(before);
  });
  it.each(["native_v2", "managed"] as const)("resolves %s from one setting in production", name => {
    const env = { CALL_RUNTIME_PROFILE: name, NODE_ENV: "production" };
    expect(voiceRuntimeMode(env)).toBe(runtimeProfiles[name].mode);
    expect(voiceRuntimeDriver(env)).toBe("live");
    expect(voiceAgentHangupEnabled(env)).toBe(true);
  });
  it.each([
    { VOICE_RUNTIME_DRIVER: "realtime" }, { VOICE_RUNTIME_LIVE_FALLBACK: "true" },
    { VOICE_RUNTIME_LIVE_EXPERIMENT: "off" }, { REALTIME_AGENT_HANGUP_ENABLED: "false" }
  ])("rejects stale conflicting overrides %j", overrides => {
    expect(() => selectedRuntimeProfile({ CALL_RUNTIME_PROFILE: "native_v2", ...overrides })).toThrow("conflicts with");
  });
  it("retains low-level compatibility and validates profile names", () => {
    expect(selectedRuntimeProfile({})).toBeNull();
    expect(voiceRuntimeMode({})).toBe("unified_live");
    expect(voiceRuntimeMode({ VOICE_RUNTIME_DRIVER: "realtime" })).toBe("legacy_realtime");
    expect(() => selectedRuntimeProfile({ CALL_RUNTIME_PROFILE: "future" })).toThrow("CALL_RUNTIME_PROFILE must be");
  });
  it("rejects a preparation mismatch before API/worker startup without changing settings", async () => {
    const repository = new InMemoryCallRepository();
    const before = await repository.getPreparationSettings();
    await expect(assertRuntimeProfileReady(repository, { CALL_RUNTIME_PROFILE: "native_v2" })).rejects.toThrow("RUNTIME_PROFILE_MISMATCH");
    expect(await repository.getPreparationSettings()).toEqual(before);
    const native = new InMemoryCallRepository({ preparationPromptVersion: runtimeProfiles.native_v2.promptVersion });
    expect(await assertRuntimeProfileReady(native, { CALL_RUNTIME_PROFILE: "native_v2" })).toMatchObject({ ready: true, compilerVersion: "brief-compiler-17" });
    await expect(assertRuntimeProfileReady(native, { CALL_RUNTIME_PROFILE: "managed" })).rejects.toThrow("RUNTIME_PROFILE_MISMATCH");
  });
  it.each(["native_v2", "managed"] as const)("prepares new %s tasks with the declared compiler/schema", async name => {
    const input = normalizeCreateCallBriefInput({ recipientName: "Office", phoneNumber: "+41710000121", objective: "Ask about office opening hours",
      assistantProfileId: "sebastian", representedPersonFirstName: "Test", representedPersonLastName: "Owner", locale: "en-GB", allowedFacts: [] });
    const compilation = await new DeterministicBriefCompiler().compile(input, 1, {
      policy: { ...defaultPreparationRuntimePolicy, promptVersion: runtimeProfiles[name].promptVersion }
    });
    expect(compilation.compilerVersion).toBe(runtimeProfiles[name].compilerVersion);
    expect(compilation.compiledBrief?.schemaVersion).toBe(runtimeProfiles[name].planSchemaVersion);
  });
});
