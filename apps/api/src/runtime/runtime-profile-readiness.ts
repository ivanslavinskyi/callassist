import type { PreparationSettingsView } from "@callassist/contracts";
import { selectedRuntimeProfile } from "../config/runtime-profile";

export function runtimeProfileStatus(settings: PreparationSettingsView, environment: NodeJS.ProcessEnv = process.env) {
  const profile = selectedRuntimeProfile(environment);
  if (!profile) return undefined;
  return { name: profile.name, release: profile.release, mode: profile.mode,
    runtimeVersion: profile.runtimeVersion, compilerVersion: profile.compilerVersion,
    planSchemaVersion: profile.planSchemaVersion, expectedPromptVersion: profile.promptVersion,
    actualPromptVersion: settings.policy.promptVersion,
    ready: settings.policy.promptVersion === profile.promptVersion };
}

export async function assertRuntimeProfileReady(repository: { getPreparationSettings(): Promise<PreparationSettingsView> },
  environment: NodeJS.ProcessEnv = process.env) {
  if (!selectedRuntimeProfile(environment)) return undefined;
  const status = runtimeProfileStatus(await repository.getPreparationSettings(), environment)!;
  if (!status.ready) throw new Error(`RUNTIME_PROFILE_MISMATCH: ${status.name} requires ${status.expectedPromptVersion}; ` +
    `stored policy is ${status.actualPromptVersion}. Stop API/workers and run runtime:configure --apply with the intended CALL_RUNTIME_PROFILE before starting them.`);
  return status;
}
