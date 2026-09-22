import { createHash } from "node:crypto";
import { Zip, ZipDeflate } from "fflate";
import type postgres from "postgres";
import type { DataEncryptionMaterial } from "../security/encryption";
import { exportScopeSql, exportSources, mapExportRow, sourceQuery } from "./sources";

export const exportMaxBytes = 250 * 1024 * 1024;
export const exportPartBytes = 1024 * 1024;
export class ExportError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); }
}
export type ArchiveContext = { id: string; from: string; to: string; createdAt: string; generation: number };

export async function buildTelemetryArchive(
  tx: postgres.TransactionSql, context: ArchiveContext, key: DataEncryptionMaterial,
  save: (bytes: Buffer, records: number, phase: string) => Promise<void>,
  check: () => Promise<void>
) {
  const started = Date.now();
  const [snapshot] = await tx<{ at: Date; revision: string }[]>`SELECT clock_timestamp() AS at,revision::text FROM admin_telemetry_privacy_epoch WHERE id=true`;
  const snapshotAt = snapshot!.at.toISOString();
  const parameters = [context.from, context.to];
  const [scope] = await tx.unsafe<Record<string, number>[]>(`${exportScopeSql} SELECT
    (SELECT count(*)::int FROM export_calls) AS calls,
    (SELECT count(*)::int FROM export_calls WHERE NOT available) AS unavailable_calls,
    (SELECT count(*)::int FROM export_preparations) AS preparations,
    (SELECT count(*)::int FROM call_attempts WHERE call_brief_id IN (SELECT id FROM export_calls) AND started_at >= $1::timestamptz AND started_at < $2::timestamptz) AS selected_attempts`, parameters);
  if (!scope || scope.calls! > 10000 || scope.preparations! > 10000 || scope.selected_attempts! > 10000) throw new ExportError("EXPORT_LIMIT_EXCEEDED");
  let output: Buffer[] = [], buffered = Buffer.alloc(0), failure: Error | null = null;
  let bytes = 0, rawBytes = 0, records = 0, phase = "manifest", finalized = false;
  const digest = createHash("sha256");
  const zip = new Zip((error, data, final) => {
    if (error) { failure = error; return; }
    output.push(Buffer.from(data)); finalized ||= final;
  });
  async function flush(final = false) {
    if (failure) throw failure;
    if (Date.now() - started > 60_000) throw new ExportError("EXPORT_SNAPSHOT_TIMEOUT");
    await check();
    // fflate emits bounded compressed chunks after each pushed record. Drain them
    // before reading the next source batch; never collect a whole file/archive.
    for (const chunk of output) {
      let offset = 0;
      while (offset < chunk.length) {
        const length = Math.min(exportPartBytes - buffered.length, chunk.length - offset);
        buffered = Buffer.concat([buffered, chunk.subarray(offset, offset + length)]);
        offset += length;
        if (buffered.length === exportPartBytes) {
          bytes += buffered.length; digest.update(buffered); await save(buffered, records, phase); buffered = Buffer.alloc(0);
        }
      }
    }
    output = [];
    if (final && buffered.length) {
      bytes += buffered.length; digest.update(buffered); await save(buffered, records, phase); buffered = Buffer.alloc(0);
    }
  }
  function addFile(name: string) {
    const file = new ZipDeflate(name, { level: 3 }); zip.add(file); return file;
  }
  function encode(value: unknown) {
    const line = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
    rawBytes += line.length;
    if (line.length > 16 * 1024 * 1024 || rawBytes > exportMaxBytes) throw new ExportError("EXPORT_LIMIT_EXCEEDED");
    return line;
  }
  const files: Array<{ path: string; records: number; bytes: number; sha256: string }> = [];
  const counts: Record<string, number> = { ...scope };
  const outcomes: Record<string, number> = {};
  const pending: Record<string, number> = {};
  const costs: Record<string, bigint> = {};
  const warnings = [
    "Period selects attempt start times and preparation creation times; associated history extends outside the period.",
    "Live transcript segments are call-scoped and have no persisted attempt attribution.",
    "SSE deltas, audio bytes and historical runtime instructions are not included.",
    "Provider billing is account context, never additive to per-operation costs.",
    "Null content may be absent, pending, legacy or deleted; consult source status. No historical content is reconstructed.",
    "raw_usage/raw_cost keep numeric trees and allowlisted enums; arbitrary provider strings and audit metadata are omitted.",
    "effective_provider_usage replaces missing measurements; do not add it to the original usage records."
  ];
  try {
    for (const s of exportSources) {
      phase = s.table;
      const path = `data/${s.table}.jsonl`, entry = addFile(path), hash = createHash("sha256");
      let count = 0, size = 0;
      const batchSize = s.fields.some(field => field.endsWith("_ciphertext") || field === "text") ? 1 : 100;
      for await (const batch of tx.unsafe<Array<{ data: Record<string, unknown>; available?: boolean }>>(sourceQuery(s), parameters).cursor(batchSize)) {
        for (const row of batch) {
          let record: ReturnType<typeof mapExportRow>;
          try { record = mapExportRow(s, row.data, key, row.available); }
          catch { throw new ExportError("EXPORT_SOURCE_DECRYPTION_FAILED"); }
          if (s.table === "call_attempts") {
            const at = String(row.data.started_at);
            const selected = Date.parse(at) >= Date.parse(context.from) && Date.parse(at) < Date.parse(context.to);
            Object.assign(record, { selectedInPeriod: selected });
            if (selected) { const status = String(row.data.status); outcomes[status] = (outcomes[status] ?? 0) + 1; }
          }
          if (["final_transcripts", "call_text_artifacts", "call_assessments"].includes(s.table) && ["processing", "queued", "pending"].includes(String(row.data.status))) pending[s.table] = (pending[s.table] ?? 0) + 1;
          if (s.table === "provider_cost_records") {
            const currency = String(row.data.currency); costs[currency] = (costs[currency] ?? 0n) + BigInt(String(row.data.amount_micros));
          }
          const line = encode(record); records++; count++; size += line.length; hash.update(line);
          if (records > 1_000_000) throw new ExportError("EXPORT_LIMIT_EXCEEDED");
          entry.push(line, false);
          // A single large record may produce many output blocks.
          if (output.reduce((n, b) => n + b.length, 0) >= exportPartBytes) await flush();
        }
        await flush();
      }
      entry.push(new Uint8Array(), true); await flush();
      counts[s.table] = count; files.push({ path, records: count, bytes: size, sha256: hash.digest("hex") });
    }
    const docs: Record<string, unknown> = {
      "summary.json": { scope, attemptStatuses: outcomes, pending, reportedCostMicrosByCurrency: Object.fromEntries(Object.entries(costs).map(([k, v]) => [k, v.toString()])), costScope: "All associated operations, including preparation outside the selected period. effective_provider_usage includes versioned calculated_cost per operation; these estimates must not be added to provider-reported actuals.", counts },
      "schema.json": { formatVersion: 1, encoding: "UTF-8", dataFormat: "JSON Lines", recordEnvelope: { schemaVersion: 1, recordType: "source table", data: "allowlisted source columns; ciphertext suffix removed after decryption" }, sources: Object.fromEntries(exportSources.map(s => [s.table, [...s.fields.map(f => f.replace(/_ciphertext$/, "")), ...(s.table === "effective_provider_usage" ? ["provider", "operation_type", "stage", "model", "calculated_cost"] : [])]])), numericPolicy: "Monetary micros are decimal strings; null is unknown, never zero." },
      "manifest.json": { schemaVersion: 1, exportId: context.id, generation: context.generation, requestedAt: context.createdAt, snapshotCapturedAt: snapshotAt, generatedAt: new Date().toISOString(), period: { from: context.from, to: context.to, timezone: "Europe/Zurich", bounds: "[from,to)" }, generatorVersion: "telemetry-export-v1", completeness: "all_available_allowlisted_sources", counts, files, warnings }
    };
    for (const [name, data] of Object.entries(docs)) { const entry = addFile(name); entry.push(encode(data), true); await flush(); }
    const readme = addFile("README.txt");
    readme.push(Buffer.from("SHPROHLI call telemetry v1\nEach data/*.jsonl line is one UTF-8 JSON record. Preserve IDs and source hashes when joining tables. Read manifest.json for scope, completeness and checksums. Transcripts, approved plans and reviews contain personal information. This file is a copy of the data at snapshotCapturedAt; later results require a new export.\n" + warnings.join("\n")), true);
    zip.end(); await flush(true);
    if (!finalized) throw new ExportError("EXPORT_ARCHIVE_INCOMPLETE");
    return { snapshotAt, privacyRevision: snapshot!.revision, records, bytes, counts, sha256: digest.digest("hex") };
  } finally { zip.terminate(); }
}
