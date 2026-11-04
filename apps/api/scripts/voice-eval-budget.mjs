import { resolve } from "node:path";

// Revisions share the original ledger and lock; a new candidate never resets spend.
export function voiceEvalRunPaths(root, revision = "") {
  if (revision && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(revision)) throw new Error("INVALID_REVISION");
  return { output: revision ? resolve(root, "revisions", revision) : resolve(root),
    ledger: resolve(root, "reservations.jsonl"), lock: resolve(root, "running.lock"),
    reservationPrefix: revision ? `${revision}/` : "" };
}

// Conservative reservations are never refunded, even on timeout or missing usage.
export function reserveVoiceEval(entries, id, kind, micros, limitMicros) {
  if (!Number.isSafeInteger(limitMicros) || limitMicros <= 0 || limitMicros > 5_000_000 ||
      !Number.isSafeInteger(micros) || micros <= 0 || !id || !kind) throw new Error("INVALID_BUDGET");
  if (entries.some(e => e.id === id)) throw new Error("RESERVATION_ALREADY_EXISTS");
  let total = 0;
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.reservedMicros) || entry.reservedMicros <= 0) throw new Error("INVALID_LEDGER");
    total += entry.reservedMicros;
  }
  if (total + micros > limitMicros) throw new Error("BUDGET_EXHAUSTED");
  return { id, kind, reservedMicros: micros, reservedAt: new Date().toISOString() };
}

export function validateLunaRequest(body) {
  if (body.model !== "gpt-6-luna" || body.max_output_tokens !== 512 || body.service_tier !== "default" ||
      body.store !== false || body.tools?.some(tool => tool.type !== "function") ||
      Buffer.byteLength(JSON.stringify(body)) > 50_000) throw new Error("UNBOUNDED_MODEL_REQUEST");
}
