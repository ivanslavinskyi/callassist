import type { CallBrief, CreateCallBriefInput } from "@callassist/contracts";

const storageKey = "callassist.call-preparation-attempt.v2";
const attemptLifetimeMs = 30 * 60 * 1_000;

export type CallPreparationAttempt = {
  version: 2;
  userId: string;
  fingerprint: string;
  idempotencyKey: string;
  callBriefId?: string;
  createdAt: number;
};

type SessionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export async function fingerprintCallPreparation(
  input: CreateCallBriefInput
) {
  const bytes = new TextEncoder().encode(stableJson(input));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export async function prepareCallBriefCreation({
  input,
  userId,
  current,
  storage,
  save,
  load,
  onAttempt,
  now,
  createIdempotencyKey
}: {
  input: CreateCallBriefInput;
  userId: string;
  current: CallPreparationAttempt | null;
  storage: SessionStorage | undefined;
  save: (input: CreateCallBriefInput, idempotencyKey: string) => Promise<CallBrief>;
  load: (callBriefId: string) => Promise<CallBrief>;
  onAttempt: (attempt: CallPreparationAttempt) => void;
  now?: number;
  createIdempotencyKey?: () => string;
}) {
  const fingerprint = await fingerprintCallPreparation(input);
  const attempt = resolveCallPreparationAttempt({
    current: readCallPreparationAttempt(storage) ?? current,
    fingerprint,
    userId,
    ...(now === undefined ? {} : { now }),
    ...(createIdempotencyKey === undefined ? {} : { createIdempotencyKey })
  });
  onAttempt(attempt);
  writeCallPreparationAttempt(storage, attempt);

  if (attempt.callBriefId) return load(attempt.callBriefId);

  const brief = await save(input, attempt.idempotencyKey);
  const completedAttempt = markCallPreparationCreated(attempt, brief.id);
  onAttempt(completedAttempt);
  writeCallPreparationAttempt(storage, completedAttempt);
  return brief;
}

export function readCallPreparationAttempt(
  storage: SessionStorage | undefined
): CallPreparationAttempt | null {
  if (!storage) return null;
  try {
    const value = JSON.parse(storage.getItem(storageKey) ?? "null") as unknown;
    return isCallPreparationAttempt(value) ? value : null;
  } catch {
    return null;
  }
}

export function resolveCallPreparationAttempt({
  current,
  fingerprint,
  userId,
  now = Date.now(),
  createIdempotencyKey = () => crypto.randomUUID()
}: {
  current: CallPreparationAttempt | null;
  fingerprint: string;
  userId: string;
  now?: number;
  createIdempotencyKey?: () => string;
}): CallPreparationAttempt {
  if (
    current?.fingerprint === fingerprint &&
    current.userId === userId &&
    now >= current.createdAt &&
    now - current.createdAt < attemptLifetimeMs
  ) {
    return current;
  }

  return {
    version: 2,
    userId,
    fingerprint,
    idempotencyKey: createIdempotencyKey(),
    createdAt: now
  };
}

export function writeCallPreparationAttempt(
  storage: SessionStorage | undefined,
  attempt: CallPreparationAttempt
) {
  if (!storage) return;
  try {
    storage.setItem(storageKey, JSON.stringify(attempt));
  } catch {
    // The in-memory copy still protects retries while this component is mounted.
  }
}

export function markCallPreparationCreated(
  attempt: CallPreparationAttempt,
  callBriefId: string
): CallPreparationAttempt {
  return { ...attempt, callBriefId };
}

export function consumeCallPreparationAttempt(
  storage: SessionStorage | undefined,
  callBriefId: string
) {
  if (!storage) return;
  const attempt = readCallPreparationAttempt(storage);
  if (attempt?.callBriefId !== callBriefId) return;
  try {
    storage.removeItem(storageKey);
  } catch {
    // A storage failure cannot invalidate the already-created call brief.
  }
}

export function getCallPreparationSessionStorage(): SessionStorage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function isCallPreparationAttempt(value: unknown): value is CallPreparationAttempt {
  if (!value || typeof value !== "object") return false;
  const attempt = value as Partial<CallPreparationAttempt>;
  return attempt.version === 2 &&
    isUuid(attempt.userId) &&
    typeof attempt.fingerprint === "string" &&
    /^[a-f0-9]{64}$/.test(attempt.fingerprint) &&
    isUuid(attempt.idempotencyKey) &&
    typeof attempt.createdAt === "number" &&
    Number.isFinite(attempt.createdAt) &&
    (attempt.callBriefId === undefined || isUuid(attempt.callBriefId));
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
