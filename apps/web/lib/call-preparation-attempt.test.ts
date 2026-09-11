import { describe, expect, it } from "vitest";
import type { CallBrief, CreateCallBriefInput } from "@callassist/contracts";
import { ApiError, CallPreparationFailedError } from "./api";
import {
  consumeCallPreparationAttempt,
  fingerprintCallPreparation,
  markCallPreparationCreated,
  prepareCallBriefCreation,
  readCallPreparationAttempt,
  resolveCallPreparationAttempt,
  writeCallPreparationAttempt
} from "./call-preparation-attempt";
import type { CallPreparationAttempt } from "./call-preparation-attempt";

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
  it("includes language intent in idempotency without deriving it from a later UI change", async () => {
    const russian = { mode: "manual" as const, targetLanguage: "ru" as const, uiLocaleHint: "en" };
    expect(await fingerprintCallPreparation(input, russian)).not.toBe(await fingerprintCallPreparation(input));
    expect(await fingerprintCallPreparation(input, russian)).not.toBe(await fingerprintCallPreparation(input, { ...russian, targetLanguage: "uk" }));
    expect(await fingerprintCallPreparation(input, russian)).toBe(await fingerprintCallPreparation({ ...input }, { ...russian }));
    expect(await fingerprintCallPreparation(input, russian, "new")).not.toBe(await fingerprintCallPreparation(input, russian, "existing-call"));
  });
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

  it("retires a newly failed operation only for the next explicit submit, preserving the input", async () => {
    const storage = memoryStorage();
    const original = structuredClone(input);
    const keys: string[] = [];
    let current: CallPreparationAttempt | null = null;
    const submit = () => prepareCallBriefCreation({
      input, userId: userOne, current, storage,
      createIdempotencyKey: () => keys.length ? operationTwo : operationOne,
      onAttempt: (attempt) => { current = attempt; },
      load: async (id) => brief(id),
      save: async (value, key) => {
        expect(value).toEqual(original);
        keys.push(key);
        if (keys.length === 1) throw new CallPreparationFailedError("BRIEF_COMPILER_UNAVAILABLE");
        return brief(briefOne);
      }
    });

    await expect(submit()).rejects.toBeInstanceOf(CallPreparationFailedError);
    expect(keys).toEqual([operationOne]);
    expect(readCallPreparationAttempt(storage)).toMatchObject({ failed: true, idempotencyKey: operationOne });
    current = null; // A locale switch/remount must keep the failure marker.
    await expect(submit()).resolves.toMatchObject({ id: briefOne });
    expect(keys).toEqual([operationOne, operationTwo]);
    expect(input).toEqual(original);
  });

  it.each([false, true])("recovers an old uncertain key once during explicit retry; fresh failure=%s stops", async (freshFailure) => {
    const storage = memoryStorage();
    const keys: string[] = [];
    let current: CallPreparationAttempt | null = null;
    const submit = () => prepareCallBriefCreation({
      input, userId: userOne, current, storage,
      createIdempotencyKey: () => keys.length ? operationTwo : operationOne,
      onAttempt: (attempt) => { current = attempt; },
      load: async (id) => brief(id),
      save: async (value, key) => {
        expect(value).toEqual(input);
        keys.push(key);
        if (keys.length === 1) throw new ApiError("CALL_PREPARATION_TIMEOUT", 504);
        if (key === operationOne || freshFailure) throw new CallPreparationFailedError("BRIEF_COMPILER_UNAVAILABLE");
        return brief(briefOne);
      }
    });

    await expect(submit()).rejects.toMatchObject({ code: "CALL_PREPARATION_TIMEOUT" });
    expect(readCallPreparationAttempt(storage)?.failed).toBeUndefined();
    current = null;
    if (freshFailure) await expect(submit()).rejects.toBeInstanceOf(CallPreparationFailedError);
    else await expect(submit()).resolves.toMatchObject({ id: briefOne });
    expect(keys).toEqual([operationOne, operationOne, operationTwo]);
    expect(readCallPreparationAttempt(storage)).toMatchObject(freshFailure
      ? { idempotencyKey: operationTwo, failed: true }
      : { idempotencyKey: operationTwo, callBriefId: briefOne });
  });

  it("keeps a timed-out operation key when the server has not confirmed a terminal failure", async () => {
    const storage = memoryStorage();
    const keys: string[] = [];
    let current: CallPreparationAttempt | null = null;
    const submit = () => prepareCallBriefCreation({
      input, userId: userOne, current, storage,
      createIdempotencyKey: () => keys.length ? operationTwo : operationOne,
      onAttempt: (attempt) => { current = attempt; },
      load: async (id) => brief(id),
      save: async (_value, key) => {
        keys.push(key);
        if (keys.length === 1) throw new ApiError("CALL_PREPARATION_TIMEOUT", 504);
        return brief(briefOne);
      }
    });

    await expect(submit()).rejects.toMatchObject({ code: "CALL_PREPARATION_TIMEOUT" });
    current = null;
    await expect(submit()).resolves.toMatchObject({ id: briefOne });
    expect(keys).toEqual([operationOne, operationOne]);
  });

  it("keeps the current failure marker when storage can read an old key but cannot write", async () => {
    const backing = memoryStorage();
    let rejectWrites = false;
    const storage = {
      ...backing,
      setItem: (key: string, value: string) => {
        if (rejectWrites) throw new Error("quota exceeded");
        backing.setItem(key, value);
      }
    };
    const keys: string[] = [];
    let current: CallPreparationAttempt | null = null;
    const submit = () => prepareCallBriefCreation({
      input, userId: userOne, current, storage,
      createIdempotencyKey: () => keys.length ? operationTwo : operationOne,
      onAttempt: (attempt) => { current = attempt; },
      load: async (id) => brief(id),
      save: async (_value, key) => {
        keys.push(key);
        rejectWrites = true;
        if (keys.length === 1) throw new CallPreparationFailedError("BRIEF_COMPILER_UNAVAILABLE");
        return brief(briefOne);
      }
    });

    await expect(submit()).rejects.toBeInstanceOf(CallPreparationFailedError);
    expect(readCallPreparationAttempt(storage)?.failed).toBeUndefined();
    await expect(submit()).resolves.toMatchObject({ id: briefOne });
    expect(keys).toEqual([operationOne, operationTwo]);
  });

  it("resumes the current draft even when session storage contains another draft", async () => {
    const current = resolveCallPreparationAttempt({
      current: null, fingerprint: await fingerprintCallPreparation(input, undefined, "draft-a"),
      userId: userOne, createIdempotencyKey: () => operationOne
    });
    const storage = memoryStorage();
    writeCallPreparationAttempt(storage, { ...current, fingerprint: "b".repeat(64), idempotencyKey: operationTwo });
    const keys: string[] = [];
    await prepareCallBriefCreation({
      input, scope: "draft-a", userId: userOne, current, storage,
      createIdempotencyKey: () => operationTwo,
      onAttempt: () => undefined,
      load: async (id) => brief(id),
      save: async (_value, key) => { keys.push(key); return brief(briefOne); }
    });
    expect(keys).toEqual([operationOne]);
  });

  it("resumes a newer replacement saved after the current locale subtree mounted", async () => {
    const current = resolveCallPreparationAttempt({
      current: null, fingerprint: await fingerprintCallPreparation(input),
      userId: userOne, now: 1_000, createIdempotencyKey: () => operationOne
    });
    const storage = memoryStorage();
    writeCallPreparationAttempt(storage, { ...current, idempotencyKey: operationTwo, createdAt: 2_000 });
    const keys: string[] = [];
    await prepareCallBriefCreation({
      input, userId: userOne, current, storage, now: 3_000,
      createIdempotencyKey: () => operationOne,
      onAttempt: () => undefined,
      load: async (id) => brief(id),
      save: async (_value, key) => { keys.push(key); return brief(briefOne); }
    });
    expect(keys).toEqual([operationTwo]);
  });

  it("deduplicates clarification retries but starts a new preparation for changed answers or source revision", async () => {
    const storage = memoryStorage();
    const serverOperations = new Set<string>();
    const requests: string[] = [];
    const generatedKeys = [operationOne, operationTwo, "00000000-0000-4000-8000-000000000103"];
    const languagePreferences = { mode: "manual" as const, targetLanguage: "ru" as const };
    let current: CallPreparationAttempt | null = null;
    let revision = 1;
    let answer = "Tuesday after 10:00";
    const submit = () => prepareCallBriefCreation({
      input: { ...input, clarificationAnswers: [{ issueCode: "missing_scheduling_constraints", answer }] },
      languagePreferences,
      scope: `clarifications:${briefOne}:${revision}:source-hash-${revision}`,
      userId: userOne, current, storage,
      createIdempotencyKey: () => generatedKeys.shift()!,
      onAttempt: (attempt) => { current = attempt; },
      load: async (id) => brief(id),
      save: async (_value, key) => {
        requests.push(key);
        serverOperations.add(key);
        if (requests.length <= 2) throw new ApiError("CALL_PREPARATION_TIMEOUT", 504);
        return brief(briefOne);
      }
    });

    await expect(submit()).rejects.toMatchObject({ code: "CALL_PREPARATION_TIMEOUT" });
    current = null; // A remount must resume the same work, including its language intent.
    await expect(submit()).rejects.toMatchObject({ code: "CALL_PREPARATION_TIMEOUT" });
    expect(requests).toEqual([operationOne, operationOne]);
    expect(serverOperations.size).toBe(1);
    answer = "Wednesday after 11:00";
    await submit();
    expect(requests.at(-1)).toBe(operationTwo);
    revision = 2;
    await submit();
    expect(serverOperations.size).toBe(3);
    expect(requests).toHaveLength(4);
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
    representedPersonFirstName: input.representedPersonFirstName,
    representedPersonLastName: input.representedPersonLastName,
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
