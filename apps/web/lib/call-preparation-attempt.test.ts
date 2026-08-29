import { describe, expect, it } from "vitest";
import type { CallBrief, CreateCallBriefInput } from "@callassist/contracts";
import {
  consumeCallPreparationAttempt,
  fingerprintCallPreparation,
  markCallPreparationCreated,
  prepareCallBriefCreation,
  readCallPreparationAttempt,
  resolveCallPreparationAttempt,
  writeCallPreparationAttempt
} from "./call-preparation-attempt";

const input: CreateCallBriefInput = {
  recipientName: "Praxis Beispiel",
  phoneNumber: "+41710000000",
  objective: "Arrange a follow-up appointment",
  assistantProfileId: "sebastian",
  representedPersonFirstName: "Max",
  representedPersonLastName: "Mustermann",
  assistanceReason: "speech_impairment",
  context: "",
  locale: "de-CH",
  audioRetentionDays: 7,
  allowLanguageSwitch: false,
  allowedFacts: ["Available next Tuesday"],
  resultHandling: "capture_in_callassist",
  addressingMode: "formal",
  tonePreference: "auto",
  voicemailPolicy: "do_not_leave_details",
  deliveryInstruction: "",
  clarificationAnswers: []
};
const userOne = "00000000-0000-4000-8000-000000000001";
const userTwo = "00000000-0000-4000-8000-000000000002";
const operationOne = "00000000-0000-4000-8000-000000000101";
const operationTwo = "00000000-0000-4000-8000-000000000102";
const briefOne = "00000000-0000-4000-8000-000000000201";
const briefTwo = "00000000-0000-4000-8000-000000000202";

describe("call preparation attempts", () => {
  it("fingerprints the normalized content deterministically", async () => {
    const reordered = Object.fromEntries(
      Object.entries(input).reverse()
    ) as CreateCallBriefInput;
    await expect(fingerprintCallPreparation(input)).resolves.toBe(
      await fingerprintCallPreparation(reordered)
    );
  });

  it("reuses the operation for the same user and unchanged form", () => {
    const first = resolveCallPreparationAttempt({
      current: null,
      fingerprint: "a".repeat(64),
      userId: userOne,
      now: 1_000,
      createIdempotencyKey: () => operationOne
    });
    const retry = resolveCallPreparationAttempt({
      current: first,
      fingerprint: first.fingerprint,
      userId: first.userId,
      now: 2_000,
      createIdempotencyKey: () => operationTwo
    });
    expect(retry).toBe(first);
    expect(retry.idempotencyKey).toBe(operationOne);
  });

  it("starts a new operation after an edit, account change, or expiry", () => {
    const current = resolveCallPreparationAttempt({
      current: null,
      fingerprint: "a".repeat(64),
      userId: userOne,
      now: 1_000,
      createIdempotencyKey: () => operationOne
    });
    for (const [fingerprint, userId, now] of [
      ["b".repeat(64), userOne, 2_000],
      ["a".repeat(64), userTwo, 2_000],
      ["a".repeat(64), userOne, 30 * 60 * 1_000 + 1_000]
    ] as const) {
      expect(resolveCallPreparationAttempt({
        current,
        fingerprint,
        userId,
        now,
        createIdempotencyKey: () => operationTwo
      }).idempotencyKey).toBe(operationTwo);
    }
  });

  it("persists a completed brief until that exact page consumes it", () => {
    const storage = memoryStorage();
    const attempt = markCallPreparationCreated(
      resolveCallPreparationAttempt({
        current: null,
        fingerprint: "a".repeat(64),
        userId: userOne,
        createIdempotencyKey: () => operationOne
      }),
      briefOne
    );
    writeCallPreparationAttempt(storage, attempt);
    expect(readCallPreparationAttempt(storage)).toEqual(attempt);
    consumeCallPreparationAttempt(storage, briefTwo);
    expect(readCallPreparationAttempt(storage)).toEqual(attempt);
    consumeCallPreparationAttempt(storage, briefOne);
    expect(readCallPreparationAttempt(storage)).toBeNull();
  });

  it("recovers an uncertain response without creating a second brief", async () => {
    const storage = memoryStorage();
    const serverRequests = new Map<string, ReturnType<typeof brief>>();
    let insertions = 0;
    let loseFirstResponse = true;
    let current: import("./call-preparation-attempt").CallPreparationAttempt | null = null;
    const submit = () => prepareCallBriefCreation({
      input,
      userId: userOne,
      current,
      storage,
      createIdempotencyKey: () => operationOne,
      onAttempt: (attempt) => { current = attempt; },
      load: async (id) => brief(id),
      save: async (_value, idempotencyKey) => {
        let result = serverRequests.get(idempotencyKey);
        if (!result) {
          result = brief(briefOne);
          serverRequests.set(idempotencyKey, result);
          insertions += 1;
        }
        if (loseFirstResponse) {
          loseFirstResponse = false;
          throw new TypeError("response lost after commit");
        }
        return result;
      }
    });

    await expect(submit()).rejects.toThrow("response lost after commit");
    current = null;
    await expect(submit()).resolves.toMatchObject({ id: briefOne });
    expect(insertions).toBe(1);
    expect(serverRequests.size).toBe(1);
  });

  it("opens a confirmed brief again without another POST until navigation mounts", async () => {
    const storage = memoryStorage();
    let current: import("./call-preparation-attempt").CallPreparationAttempt | null = null;
    let saves = 0;
    let loads = 0;
    const submit = () => prepareCallBriefCreation({
      input,
      userId: userOne,
      current,
      storage,
      createIdempotencyKey: () => operationOne,
      onAttempt: (attempt) => { current = attempt; },
      save: async () => {
        saves += 1;
        return brief(briefOne);
      },
      load: async (id) => {
        loads += 1;
        return brief(id);
      }
    });

    await submit();
    await submit();
    expect({ saves, loads }).toEqual({ saves: 1, loads: 1 });
  });
});

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key)
  };
}

function brief(id: string): CallBrief {
  return {
    id,
    recipientName: input.recipientName,
    phoneNumber: input.phoneNumber,
    objective: input.objective,
    assistantProfileId: input.assistantProfileId,
    agentName: "Sebastian",
    voiceGender: "male",
    representedPerson: `${input.representedPersonFirstName} ${input.representedPersonLastName}`,
    assistanceReason: input.assistanceReason ?? "none",
    assistanceDisclosure: "CallAssist is conducting this call on behalf of Max Mustermann.",
    context: input.context ?? "",
    locale: input.locale,
    audioRetentionDays: input.audioRetentionDays ?? 7,
    allowLanguageSwitch: false,
    allowedFacts: input.allowedFacts ?? [],
    status: "review_required" as const,
    createdAt: "2026-08-27T10:00:00.000Z",
    updatedAt: "2026-08-27T10:00:00.000Z"
  };
}
