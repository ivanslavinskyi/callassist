import { createHash } from "node:crypto";
import { Zip, ZipDeflate, ZipPassThrough } from "fflate";
import type postgres from "postgres";
import type { RecordingMediaStream } from "../telephony/telephony-provider";
import type { DataEncryptionMaterial } from "../security/encryption";
import { exportCoverageQuery, exportSources, mapExportRow, sourceQuery } from "./sources";

export const exportMaxBytes = 250 * 1024 * 1024;
export const exportPartBytes = 1024 * 1024;
export class ExportError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); }
}
export const exportMaxAudioBytes = 250 * 1024 * 1024;
export const exportMaxRecordingBytes = 64 * 1024 * 1024;
export type ArchiveContext = { id: string; from: string; to: string; createdAt: string; generation: number; includeAudio?: boolean };
export type ExportRecording = { id: string; callId: string; attemptId: string; provider: string; providerRecordingId: string | null;
  status: string; consentAt: string | null; deletedAt: string | null; deleteAfter: string | null; durationSeconds: number | null; channels: number | null };
export type ArchiveAudioAccess = (recording: ExportRecording) => Promise<RecordingMediaStream | { unavailable: "deleted" | "expired" | "unavailable" | "fetch_failed"; reason: string }>;

// Compatibility helper for direct metadata-only builders/tests.
export async function buildTelemetryArchive(...args: Parameters<typeof captureTelemetryArchive>) {
  return (await captureTelemetryArchive(...args)).finish();
}

export async function captureTelemetryArchive(
  tx: postgres.TransactionSql, context: ArchiveContext, key: DataEncryptionMaterial,
  save: (bytes: Buffer, records: number, phase: string) => Promise<void>,
  check: () => Promise<void>
) {
  const started = Date.now();
  let capturing = true;
  const recordings: ExportRecording[] = [];
  const [snapshot] = await tx<{ at: Date; revision: string }[]>`SELECT clock_timestamp() AS at,revision::text FROM admin_telemetry_privacy_epoch WHERE id=true`;
  const snapshotAt = snapshot!.at.toISOString();
  const parameters = [context.from, context.to];
  const [scope] = await tx.unsafe<Record<string, number>[]>(exportCoverageQuery, parameters);
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
    if (capturing && Date.now() - started > 60_000) throw new ExportError("EXPORT_SNAPSHOT_TIMEOUT");
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
    "Transcript attribution distinguishes direct links, historical timestamp inference and unknown links.",
    "SSE frames and unrecorded historical runtime instructions are not included. Audio availability is itemized in audio-manifest.json.",
    "Provider billing is account context, never additive to per-operation costs.",
    "Null content may be absent, pending, legacy or deleted; consult source status. No historical content is reconstructed.",
    "raw_usage/raw_cost keep numeric trees and allowlisted enums; arbitrary provider strings and audit metadata are omitted.",
    "Consent policies are the values pinned to each attempt. Global consent settings and operator change notes are excluded; missing historical policies remain null.",
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
          if (s.table === "effective_provider_usage" && !["brief_moderation", "telephony_leg"].includes(String(row.data.operation_type)) &&
              (row.data.operation_type !== "realtime_session" || row.data.stage === "live_conversation")) {
            const calculated = (record.data as Record<string, unknown>).calculated_cost as { complete: boolean };
            if (!calculated.complete) counts.unpriced_usage_records = (counts.unpriced_usage_records ?? 0) + 1;
          }
          if (s.table === "call_recordings") {
            const d = row.data;
            recordings.push({ id: String(d.id), callId: String(d.call_brief_id), attemptId: String(d.call_attempt_id), provider: String(d.provider),
              providerRecordingId: d.provider_recording_id == null ? null : String(d.provider_recording_id), status: String(d.status),
              consentAt: d.consent_granted_at == null ? null : String(d.consent_granted_at), deletedAt: d.deleted_at == null ? null : String(d.deleted_at),
              deleteAfter: d.delete_after == null ? null : String(d.delete_after), durationSeconds: d.duration_seconds == null ? null : Number(d.duration_seconds),
              channels: d.channels == null ? null : Number(d.channels) });
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
    capturing = false;
    return { snapshotAt, privacyRevision: snapshot!.revision, recordings, abort: () => zip.terminate(),
      async finish(media?: ArchiveAudioAccess) {
      try {
        const audio: Array<Record<string, unknown>> = [];
        let audioBytes = 0;
        for (const recording of recordings) {
          const item: Record<string, unknown> = { recordingId: recording.id, callId: recording.callId, attemptId: recording.attemptId,
            provider: recording.provider, channels: recording.channels, durationSeconds: recording.durationSeconds,
            consentAt: recording.consentAt, deleteAfter: recording.deleteAfter, path: null, bytes: 0, sha256: null, mime: null };
          audio.push(item);
          if (!context.includeAudio) { item.status = "not_requested"; continue; }
          await check();
          if (recording.deletedAt || recording.status === "deleted" || recording.status === "deleting") { item.status = "deleted"; continue; }
          if (recording.deleteAfter && Date.parse(recording.deleteAfter) <= Date.now()) { item.status = "expired"; continue; }
          if (!recording.consentAt || !recording.deleteAfter || recording.status !== "available" || !recording.providerRecordingId || !media) {
            item.status = "unavailable"; item.reason = !recording.consentAt ? "consent_unavailable" : "media_unavailable"; continue;
          }
          const stream = await media(recording);
          if ("unavailable" in stream) { item.status = stream.unavailable; item.reason = stream.reason; continue; }
          const path = `audio/${recording.callId}/${recording.attemptId}/${recording.id}.wav`;
          if (!["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"].includes(stream.contentType)) {
            await stream.cancel(); item.status = "fetch_failed"; item.reason = "unsupported_media_type"; continue;
          }
          phase = "audio";
          const entry = new ZipPassThrough(path); zip.add(entry);
          const hash = createHash("sha256"); let size = 0;
          try {
            for await (const chunk of stream.bytes) {
              size += chunk.length; audioBytes += chunk.length;
              if (size > exportMaxRecordingBytes || audioBytes > exportMaxAudioBytes) throw new ExportError("EXPORT_AUDIO_LIMIT_EXCEEDED");
              await check(); hash.update(chunk); entry.push(chunk, false); await flush();
            }
            if (!size) throw new ExportError("EXPORT_AUDIO_STREAM_FAILED");
            entry.push(new Uint8Array(), true); await flush();
          } catch (error) {
            // An incomplete WAV must never be published as a successful file.
            throw error instanceof ExportError ? error : new ExportError("EXPORT_AUDIO_STREAM_FAILED");
          } finally { await stream.cancel(); }
          Object.assign(item, { status: "included", path, bytes: size, sha256: hash.digest("hex"), mime: stream.contentType, channels: stream.channels });
          files.push({ path, records: 1, bytes: size, sha256: String(item.sha256) });
        }
        for (const state of ["included", "deleted", "expired", "unavailable", "fetch_failed", "not_requested"]) counts[`audio_${state}`] = audio.filter(item => item.status === state).length;
        counts.audio_recordings = audio.length; counts.audio_bytes = audioBytes;
        const completeAudio = !context.includeAudio || !audio.some(item => ["unavailable", "fetch_failed"].includes(String(item.status)));
    const docs: Record<string, unknown> = {
      "audio-manifest.json": { version: 2, requested: context.includeAudio === true, complete: completeAudio, recordings: audio },
      "summary.json": { scope, attemptStatuses: outcomes, pending, reportedCostMicrosByCurrency: Object.fromEntries(Object.entries(costs).map(([k, v]) => [k, v.toString()])), costScope: "All associated operations, including preparation outside the selected period. effective_provider_usage includes versioned calculated_cost per operation; these estimates must not be added to provider-reported actuals.", counts },
      "schema.json": { formatVersion: 2, encoding: "UTF-8", dataFormat: "JSON Lines", recordEnvelope: { schemaVersion: 2, recordType: "source table", data: "allowlisted source columns; ciphertext suffix removed after decryption" }, sources: Object.fromEntries(exportSources.map(s => [s.table, [...s.fields.map(f => f.replace(/_ciphertext$/, "")), ...(s.table === "effective_provider_usage" ? ["provider", "operation_type", "stage", "model", "calculated_cost"] : [])]])), numericPolicy: "Monetary micros are decimal strings; null is unknown, never zero." },
      "manifest.json": { schemaVersion: 2, exportId: context.id, generation: context.generation, requestedAt: context.createdAt, snapshotCapturedAt: snapshotAt, generatedAt: new Date().toISOString(), period: { from: context.from, to: context.to, timezone: "Europe/Zurich", bounds: "[from,to)" }, generatorVersion: "telemetry-export-v2", completeness: completeAudio ? "all_available_allowlisted_sources" : "partial_audio", audioRequested: context.includeAudio === true, counts, files, warnings }
    };
    for (const [name, data] of Object.entries(docs)) { const entry = addFile(name); entry.push(encode(data), true); await flush(); }
    const readme = addFile("README.txt");
    readme.push(Buffer.from("SHPROHLI call telemetry v2\nEach data/*.jsonl line is one UTF-8 JSON record. Preserve IDs and source hashes when joining tables. Read manifest.json for scope, completeness and checksums. Transcripts, approved plans and reviews contain personal information. This file is a copy of the data at snapshotCapturedAt; later results require a new export.\n" + warnings.join("\n")), true);
    zip.end(); await flush(true);
    if (!finalized) throw new ExportError("EXPORT_ARCHIVE_INCOMPLETE");
    return { snapshotAt, privacyRevision: snapshot!.revision, records, bytes, counts, sha256: digest.digest("hex") };
      } finally { zip.terminate(); }
      }
    };
  } catch (error) { zip.terminate(); throw error; }
}
