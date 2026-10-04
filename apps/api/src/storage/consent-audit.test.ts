import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { InMemoryCallRepository } from "./in-memory-call-repository";
import { consentAuditCases } from "./consent-audit.fixture";
import { approvedCall } from "../voice/voice-test-helpers";

describe("in-memory consent audit", () => consentAuditCases(() => new InMemoryCallRepository()));
it("pins the policy at attempt admission and detects stale settings updates", async () => {
  const repository = new InMemoryCallRepository();
  const first = await approvedCall(undefined, repository);
  try {
    expect(await repository.getConsentRuntimePolicy(first.brief.id, first.attempt.id)).toMatchObject({ mode: "semantic_native", revision: 1 });
    const input = { mode: "hybrid_deterministic_v1" as const, expectedRevision: 1, reason: "Test hybrid admission" };
    await repository.updateVoiceConsentSettings(input, randomUUID());
    await expect(repository.updateVoiceConsentSettings(input, randomUUID())).rejects.toThrow("VOICE_CONSENT_REVISION_CONFLICT");
    const second = await approvedCall(undefined, repository, "en-GB", "CA-policy-second");
    expect(await repository.getConsentRuntimePolicy(first.brief.id, first.attempt.id)).toMatchObject({ mode: "semantic_native", revision: 1 });
    expect(await repository.getConsentRuntimePolicy(second.brief.id, second.attempt.id)).toMatchObject({ mode: "hybrid_deterministic_v1", revision: 2 });
    await second.service.close();
  } finally { await first.service.close(); }
});
