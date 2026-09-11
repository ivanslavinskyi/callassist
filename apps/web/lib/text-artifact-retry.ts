import type { CallTextArtifact } from "@callassist/contracts";

export function canRequestTextArtifact(artifact: CallTextArtifact | null | undefined) {
  return !artifact || (artifact.status === "failed" && artifact.retryable);
}
