import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import { telemetryExportViewSchema, type TelemetryExportInput, type TelemetryExportView } from "@callassist/contracts";
import { decryptJson, encryptJson, parseDataEncryptionKeyring, type DataEncryptionMaterial } from "../security/encryption";
import { writePiiSafeOperationalError } from "../runtime/pii-safe-logger";
import { isUuid } from "../storage/call-repository";
import type { TelephonyProvider } from "../telephony/telephony-provider";
import { createTelephonyProviderFromEnv } from "../telephony/create-telephony-provider";
import { captureTelemetryArchive, type ExportRecording, type ArchiveAudioAccess, ExportError } from "./archive";
import { resolveExportPeriod } from "./period";
import { exportCoverageQuery, exportScopeSql } from "./sources";

type Row = {
  include_audio: boolean; audio_deadline: Date | null;
  id: string; actor_user_id: string; status: TelemetryExportView["status"]; from_at: Date; to_at: Date;
  generation: number; records: number; bytes: string; phase: string; failure_code: string | null;
  snapshot_at: Date | null; expires_at: Date | null; created_at: Date; counts: Record<string, number>;
  sha256: string | null; lease_token: string | null; privacy_revision: string | null; input_hash: string;
};
const rowFields = "include_audio,audio_deadline,id,actor_user_id,status,from_at,to_at,generation,records,bytes::text,phase,failure_code,snapshot_at,expires_at,created_at,counts,sha256,lease_token,privacy_revision::text,input_hash";
const retryableCodes = new Set(["EXPORT_WORKER_FAILED", "EXPORT_LEASE_EXPIRED", "EXPORT_AUDIO_STREAM_FAILED"]);
function view(row: Row): TelemetryExportView {
  const status = row.status === "ready" && ((row.expires_at && row.expires_at.getTime() <= Date.now()) || (row.audio_deadline && row.audio_deadline.getTime() <= Date.now())) ? "expired" : row.status;
  return telemetryExportViewSchema.parse({ id: row.id, status, from: row.from_at.toISOString(), to: row.to_at.toISOString(), timezone: "Europe/Zurich",
    createdAt: row.created_at.toISOString(), snapshotAt: row.snapshot_at?.toISOString() ?? null, expiresAt: row.expires_at?.toISOString() ?? null,
    includeAudio: row.include_audio, audioDeadline: row.audio_deadline?.toISOString() ?? null,
    generation: row.generation, records: row.records, bytes: Number(row.bytes), phase: status === "expired" ? "expired" : row.phase,
    failureCode: row.failure_code, sha256: row.sha256, counts: row.counts, retryable: status === "failed" && row.generation < 3 && retryableCodes.has(row.failure_code ?? "") });
}

export class TelemetryExportService {
  readonly sql: postgres.Sql;
  readonly reader: postgres.Sql;
  private timer: NodeJS.Timeout | null = null;
  private draining: Promise<void> | null = null;
  private stopped = false;
  private activeAbort: AbortController | null = null;
  constructor(url: string, readonly key: DataEncryptionMaterial, private readonly mediaProvider?: Pick<TelephonyProvider, "streamRecordingMedia">) {
    this.sql = postgres(url, { max: 3, onnotice: () => undefined, connect_timeout: 5 });
    this.reader = postgres(url, { max: 1, onnotice: () => undefined, connect_timeout: 5 });
  }
  async actorAllowed(actor: string, sql: postgres.Sql | postgres.TransactionSql = this.sql) {
    const rows = await sql`SELECT id FROM users WHERE id=${actor} AND role='superadmin' AND status='active' AND phone_verified_at IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM account_deletion_requests d WHERE d.user_id=users.id AND d.status<>'completed')`;
    return rows.length === 1;
  }
  async create(actor: string, input: TelemetryExportInput) {
    const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    return this.sql.begin(async tx => {
      // Serializes admission globally and against revocation without source locks.
      await tx`SELECT revision FROM admin_telemetry_privacy_epoch WHERE id=true FOR UPDATE`;
      if (!await this.actorAllowed(actor, tx)) throw new ExportError("EXPORT_FORBIDDEN", 403);
      const [existing] = await tx.unsafe<Row[]>(`SELECT ${rowFields} FROM admin_telemetry_exports WHERE actor_user_id=$1 AND request_id=$2`, [actor, input.requestId]);
      if (existing) {
        if (existing.input_hash !== hash) throw new ExportError("EXPORT_IDEMPOTENCY_CONFLICT");
        return view(existing);
      }
      const [limits] = await tx<{ active: number; hourly: number; stored: number }[]>`SELECT
        (SELECT count(*)::int FROM admin_telemetry_exports WHERE actor_user_id=${actor} AND status IN ('queued','running')) AS active,
        (SELECT count(*)::int FROM admin_telemetry_exports WHERE actor_user_id=${actor} AND created_at>now()-interval '1 hour') AS hourly,
        (SELECT count(*)::int FROM admin_telemetry_exports WHERE status IN ('queued','running') OR (status='ready' AND expires_at>now())) AS stored`;
      if (limits!.active > 0) throw new ExportError("EXPORT_ALREADY_ACTIVE");
      if (limits!.hourly >= 10 || limits!.stored >= 4) throw new ExportError("EXPORT_CAPACITY_REACHED", 429);
      let period: ReturnType<typeof resolveExportPeriod>;
      try { period = resolveExportPeriod(input); } catch { throw new ExportError("EXPORT_INVALID_PERIOD", 400); }
      const id = randomUUID();
      await tx`INSERT INTO admin_telemetry_exports(id,actor_user_id,request_id,input_hash,reason,from_at,to_at,include_audio)
        VALUES(${id},${actor},${input.requestId},${hash},${input.reason},${period.from},${period.to},${input.includeAudio ?? true})`;
      await tx`INSERT INTO admin_telemetry_export_events(export_id,actor_user_id,action,generation) VALUES(${id},${actor},'requested',0)`;
      const [row] = await tx.unsafe<Row[]>(`SELECT ${rowFields} FROM admin_telemetry_exports WHERE id=$1`, [id]);
      return view(row!);
    });
  }
  async preview(actor: string, input: TelemetryExportInput) {
    if (!await this.actorAllowed(actor)) throw new ExportError("EXPORT_FORBIDDEN", 403);
    let period: ReturnType<typeof resolveExportPeriod>;
    try { period = resolveExportPeriod(input); } catch { throw new ExportError("EXPORT_INVALID_PERIOD", 400); }
    const [row] = await this.sql.unsafe<Array<{ recordings: number; estimatedBytes: number; unknownSizes: number; earliestDeadline: Date | null }>>(`${exportScopeSql}
      SELECT count(*)::int AS recordings, COALESCE(sum(r.duration_seconds*16000::bigint*r.channels),0)::double precision AS "estimatedBytes",
      count(*) FILTER(WHERE r.duration_seconds IS NULL OR r.channels IS NULL)::int AS "unknownSizes", min(r.delete_after) AS "earliestDeadline"
      FROM call_recordings r WHERE r.call_brief_id IN (SELECT id FROM export_calls WHERE available) AND r.status='available'
        AND r.deleted_at IS NULL AND r.consent_granted_at IS NOT NULL AND r.delete_after>now()`, [period.from, period.to]);
    const [coverage] = await this.sql.unsafe<Record<string, number>[]>(exportCoverageQuery, [period.from, period.to]);
    return { ...row!, earliestDeadline: row?.earliestDeadline?.toISOString() ?? null, coverage: coverage ?? {} };
  }
  async list(actor: string, cursor?: string) {
    let before: { at: string; id: string } | null = null;
    if (cursor) {
      try {
        if (cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
        before = JSON.parse(Buffer.from(cursor, "base64url").toString());
        if (!before || typeof before.at !== "string" || typeof before.id !== "string" || !isUuid(before.id) ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(?:\d{3})?Z$/.test(before.at) ||
          !Number.isFinite(Date.parse(before.at)) ||
          new Date(before.at).toISOString() !== before.at.replace(/(\.\d{3})\d{3}Z$/, "$1Z")) throw new Error();
      } catch { throw new ExportError("EXPORT_INVALID_CURSOR", 400); }
    }
    // Keep PostgreSQL microseconds in the cursor; JS Date would truncate them and skip rows.
    const rows = await this.sql.unsafe<(Row & { cursor_at: string })[]>(`SELECT ${rowFields},
      to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
      FROM admin_telemetry_exports WHERE actor_user_id=$1
      AND ($2::text IS NULL OR (created_at,id)<($2::text::timestamptz,$3::uuid)) ORDER BY created_at DESC,id DESC LIMIT 21`, [actor, before?.at ?? null, before?.id ?? null]);
    const last = rows[19];
    const [heartbeat] = await this.sql<{ worker_seen_at: Date | null }[]>`SELECT worker_seen_at FROM admin_telemetry_privacy_epoch WHERE id=true`;
    return { available: true, workerLastSeenAt: heartbeat?.worker_seen_at?.toISOString() ?? null, items: rows.slice(0, 20).map(view), nextCursor: rows.length > 20 && last ? Buffer.from(JSON.stringify({ at: last.cursor_at, id: last.id })).toString("base64url") : null };
  }
  async get(actor: string, id: string) {
    const [row] = await this.sql.unsafe<Row[]>(`SELECT ${rowFields} FROM admin_telemetry_exports WHERE id=$1 AND actor_user_id=$2`, [id, actor]);
    if (!row) throw new ExportError("EXPORT_NOT_FOUND", 404);
    return view(row);
  }
  async cancel(actor: string, id: string) {
    return this.sql.begin(async tx => {
      await tx`SELECT revision FROM admin_telemetry_privacy_epoch WHERE id=true FOR SHARE`;
      const [row] = await tx`SELECT status FROM admin_telemetry_exports WHERE id=${id} AND actor_user_id=${actor} FOR UPDATE`;
      if (!row) throw new ExportError("EXPORT_NOT_FOUND", 404);
      if (["queued", "running", "ready", "failed"].includes(String(row.status))) {
        await tx`UPDATE admin_telemetry_exports SET status='cancelled',phase='cancelled',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=${id}`;
        await tx`DELETE FROM admin_telemetry_export_parts WHERE export_id=${id}`;
        await tx`INSERT INTO admin_telemetry_export_events(export_id,actor_user_id,action,generation) SELECT id,${actor},'cancelled',generation FROM admin_telemetry_exports WHERE id=${id}`;
      }
    });
  }
  async retry(actor: string, id: string) {
    await this.sql.begin(async tx => {
      await tx`SELECT revision FROM admin_telemetry_privacy_epoch WHERE id=true FOR UPDATE`;
      if (!await this.actorAllowed(actor, tx)) throw new ExportError("EXPORT_FORBIDDEN", 403);
      const [row] = await tx.unsafe<Row[]>(`SELECT ${rowFields} FROM admin_telemetry_exports WHERE id=$1 AND actor_user_id=$2 FOR UPDATE`, [id, actor]);
      if (!row) throw new ExportError("EXPORT_NOT_FOUND", 404);
      if (!view(row).retryable) throw new ExportError("EXPORT_RETRY_UNAVAILABLE");
      const active = await tx`SELECT id FROM admin_telemetry_exports WHERE actor_user_id=${actor} AND status IN ('queued','running')`;
      const [capacity] = await tx`SELECT count(*)::int AS count FROM admin_telemetry_exports WHERE status IN ('queued','running') OR (status='ready' AND expires_at>now())`;
      if (active.length || Number(capacity!.count) >= 4) throw new ExportError("EXPORT_CAPACITY_REACHED", 429);
      await tx`UPDATE admin_telemetry_exports SET status='queued',phase='queued',run_after=now(),updated_at=now() WHERE id=${id}`;
      await tx`INSERT INTO admin_telemetry_export_events(export_id,actor_user_id,action,generation) VALUES(${id},${actor},'retry',${row.generation})`;
    });
    return this.get(actor, id);
  }
  async cleanup() {
    await this.sql.begin(async tx => {
      await tx`SELECT revision FROM admin_telemetry_privacy_epoch WHERE id=true FOR UPDATE`;
      await tx`INSERT INTO admin_telemetry_export_events(export_id,action,generation,code)
        SELECT id,'lease_expired',generation,'EXPORT_LEASE_EXPIRED' FROM admin_telemetry_exports WHERE status='running' AND lease_until<now()`;
      await tx`UPDATE admin_telemetry_exports SET status=CASE WHEN generation<3 THEN 'queued' ELSE 'failed' END,
        phase=CASE WHEN generation<3 THEN 'queued' ELSE 'failed' END,failure_code='EXPORT_LEASE_EXPIRED',lease_token=NULL,lease_until=NULL,updated_at=now()
        WHERE status='running' AND lease_until<now()`;
      await tx`UPDATE admin_telemetry_exports SET status='expired',phase='expired',updated_at=now()
        WHERE (status='ready' AND (expires_at<=now() OR audio_deadline<=now())) OR (status='queued' AND created_at<now()-interval '24 hours')`;
      await tx`DELETE FROM admin_telemetry_export_parts p USING admin_telemetry_exports e
        WHERE p.export_id=e.id AND (e.status NOT IN ('running','ready') OR p.generation<>e.generation)`;
      await tx`DELETE FROM admin_telemetry_export_recordings p USING admin_telemetry_exports e
        WHERE p.export_id=e.id AND (e.status NOT IN ('running','ready') OR p.generation<>e.generation)`;
    });
  }
  async runOnce() {
    await this.sql`UPDATE admin_telemetry_privacy_epoch SET worker_seen_at=now() WHERE id=true`;
    await this.cleanup();
    const token = randomUUID();
    const job = await this.sql.begin(async tx => {
      const [epoch] = await tx`SELECT revision FROM admin_telemetry_privacy_epoch WHERE id=true FOR UPDATE`;
      if ((await tx`SELECT id FROM admin_telemetry_exports WHERE status='running'`).length) return null;
      const [row] = await tx.unsafe<Row[]>(`SELECT ${rowFields} FROM admin_telemetry_exports WHERE status='queued' AND run_after<=now() ORDER BY created_at,id LIMIT 1 FOR UPDATE`);
      if (!row) return null;
      if (!await this.actorAllowed(row.actor_user_id, tx)) {
        await tx`UPDATE admin_telemetry_exports SET status='revoked',phase='revoked',failure_code='EXPORT_FORBIDDEN' WHERE id=${row.id}`;
        return null;
      }
      await tx`UPDATE admin_telemetry_exports SET status='running',phase='snapshot',generation=generation+1,
        lease_token=${token},lease_until=now()+interval '120 seconds',privacy_revision=${epoch!.revision},
        records=0,bytes=0,counts='{}',failure_code=NULL,sha256=NULL,snapshot_at=NULL,expires_at=NULL,audio_deadline=NULL,updated_at=now() WHERE id=${row.id}`;
      await tx`DELETE FROM admin_telemetry_export_parts WHERE export_id=${row.id}`;
      await tx`INSERT INTO admin_telemetry_export_events(export_id,action,generation) VALUES(${row.id},'started',${row.generation + 1})`;
      return { ...row, generation: row.generation + 1, privacy_revision: String(epoch!.revision) };
    });
    if (!job) return;
    let part = 0;
    const controller = new AbortController(); this.activeAbort = controller;
    const buildStarted = Date.now();
    let captured: Awaited<ReturnType<typeof captureTelemetryArchive>> | undefined;
    const fence = async (tx: postgres.TransactionSql) => {
      const [epoch] = await tx`SELECT revision::text FROM admin_telemetry_privacy_epoch WHERE id=true FOR SHARE`;
      const rows = await tx`SELECT id FROM admin_telemetry_exports WHERE id=${job.id} AND status='running'
        AND lease_token=${token} AND generation=${job.generation} AND lease_until>now()
        AND (audio_deadline IS NULL OR audio_deadline>now()) FOR UPDATE`;
      if (String(epoch!.revision) !== job.privacy_revision || !rows.length || this.stopped) throw new ExportError("EXPORT_REVOKED");
    };
    const check = async () => {
      if (this.stopped || controller.signal.aborted) throw new ExportError("EXPORT_REVOKED");
      if (Date.now() - buildStarted > 30 * 60_000) throw new ExportError("EXPORT_BUILD_TIMEOUT");
      const rows = await this.sql`SELECT id FROM admin_telemetry_exports WHERE id=${job.id} AND status='running'
        AND lease_token=${token} AND lease_until>now() AND (audio_deadline IS NULL OR audio_deadline>now())`;
      if (!rows.length) { controller.abort(); throw new ExportError("EXPORT_REVOKED"); }
    };
    let renewing: Promise<void> | null = null;
    const timer = setInterval(() => {
      if (renewing) return;
      renewing = this.sql`UPDATE admin_telemetry_exports SET lease_until=now()+interval '120 seconds',updated_at=now()
        WHERE id=${job.id} AND status='running' AND lease_token=${token} AND generation=${job.generation} AND lease_until>now()`
        .then(async () => { await check(); await this.sql`UPDATE admin_telemetry_privacy_epoch SET worker_seen_at=now() WHERE id=true`; })
        .catch(() => { controller.abort(); }).finally(() => { renewing = null; });
    }, 15_000);
    timer.unref();
    try {
      captured = await this.reader.begin("isolation level repeatable read read only", async tx => {
        await tx`SET LOCAL statement_timeout='60s'`;
        await tx`SET LOCAL idle_in_transaction_session_timeout='15s'`;
        await tx`SET LOCAL transaction_timeout='60s'`;
        return captureTelemetryArchive(tx, { id: job.id, from: job.from_at.toISOString(), to: job.to_at.toISOString(), createdAt: job.created_at.toISOString(), generation: job.generation, includeAudio: job.include_audio }, this.key,
          async (buffer, records, phase) => {
            await this.sql.begin(async writer => {
              await fence(writer);
              const payload = encryptJson(buffer.toString("base64"), this.key);
              await writer`INSERT INTO admin_telemetry_export_parts(export_id,generation,part,payload_ciphertext,byte_count,sha256)
                VALUES(${job.id},${job.generation},${part},${payload},${buffer.length},${createHash("sha256").update(buffer).digest("hex")})`;
              await writer`UPDATE admin_telemetry_exports SET records=${records},bytes=bytes+${buffer.length},phase=${phase},updated_at=now() WHERE id=${job.id}`;
            });
            part++;
          }, check);
      });
      if (job.include_audio) await this.sql.begin(async tx => {
        await fence(tx);
        for (const recording of captured!.recordings) {
          if (recording.status !== "available" || !recording.consentAt || recording.deletedAt || !recording.deleteAfter || Date.parse(recording.deleteAfter) <= Date.now()) continue;
          await tx`INSERT INTO admin_telemetry_export_recordings(export_id,generation,recording_id,delete_after)
            VALUES(${job.id},${job.generation},${recording.id},${recording.deleteAfter}) ON CONFLICT DO NOTHING`;
        }
        await tx`UPDATE admin_telemetry_exports SET audio_deadline=(SELECT min(delete_after) FROM admin_telemetry_export_recordings
          WHERE export_id=${job.id} AND generation=${job.generation}) WHERE id=${job.id}`;
      });
      const result = await captured.finish(job.include_audio ? recording => this.fetchAudio(recording, controller.signal, check) : undefined);
      await this.sql.begin(async tx => {
        await fence(tx);
        if (result.privacyRevision !== job.privacy_revision || !await this.actorAllowed(job.actor_user_id, tx)) throw new ExportError("EXPORT_REVOKED");
        await tx`UPDATE admin_telemetry_exports SET status='ready',phase='ready',snapshot_at=${result.snapshotAt},
          records=${result.records},bytes=${result.bytes},counts=${tx.json(result.counts)},sha256=${result.sha256},expires_at=LEAST(now()+interval '24 hours',audio_deadline),
          lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=${job.id}`;
        await tx`INSERT INTO admin_telemetry_export_events(export_id,action,generation) VALUES(${job.id},'ready',${job.generation})`;
      });
    } catch (error) {
      const code = error instanceof ExportError ? error.code : "EXPORT_WORKER_FAILED";
      await this.sql.begin(async tx => {
        await tx`SELECT revision FROM admin_telemetry_privacy_epoch WHERE id=true FOR SHARE`;
        const status = code === "EXPORT_REVOKED" ? "revoked" : retryableCodes.has(code) && job.generation < 3 ? "queued" : "failed";
        const changed = await tx`UPDATE admin_telemetry_exports SET status=${status},phase=${status},failure_code=${code},
          run_after=now()+interval '10 seconds',lease_token=NULL,lease_until=NULL,updated_at=now()
          WHERE id=${job.id} AND lease_token=${token} AND generation=${job.generation} RETURNING id`;
        // Never erase a newer worker's generation.
        await tx`DELETE FROM admin_telemetry_export_parts WHERE export_id=${job.id} AND generation=${job.generation}`;
        if (changed.length) await tx`INSERT INTO admin_telemetry_export_events(export_id,action,generation,code) VALUES(${job.id},${status},${job.generation},${code})`;
      });
      if (!(error instanceof ExportError)) writePiiSafeOperationalError("telemetry_export_worker_failed");
    } finally {
      clearInterval(timer); await renewing; captured?.abort(); controller.abort();
      if (this.activeAbort === controller) this.activeAbort = null;
    }
  }
  private async fetchAudio(recording: ExportRecording, signal: AbortSignal, check: () => Promise<void>): ReturnType<ArchiveAudioAccess> {
    await check();
    const [current] = await this.sql`SELECT r.status,r.deleted_at,r.delete_after,r.consent_granted_at
      FROM call_recordings r JOIN call_briefs b ON b.id=r.call_brief_id JOIN users u ON u.id=b.user_id
      WHERE r.id=${recording.id} AND b.data_deleted_at IS NULL AND u.status<>'deleted'
        AND NOT EXISTS(SELECT 1 FROM account_deletion_requests d WHERE d.user_id=u.id AND d.status<>'completed')`;
    if (!current || current.deleted_at || current.status === "deleted" || current.status === "deleting") return { unavailable: "deleted", reason: "source_deleted" };
    if (current.delete_after && new Date(current.delete_after).getTime() <= Date.now()) return { unavailable: "expired", reason: "retention_expired" };
    if (current.status !== "available" || !current.consent_granted_at || !current.delete_after || !this.mediaProvider?.streamRecordingMedia ||
      !recording.providerRecordingId || recording.provider !== "twilio" || ![1,2].includes(recording.channels ?? 0)) return { unavailable: "unavailable", reason: "media_unavailable" };
    for (let attempt=0; attempt<3; attempt++) {
      await check();
      try { return await this.mediaProvider.streamRecordingMedia(recording.providerRecordingId, recording.channels as 1|2, signal); }
      catch (error) {
        const code = error instanceof Error ? error.message : "";
        if (signal.aborted) throw new ExportError("EXPORT_REVOKED");
        if (code === "TWILIO_RECORDING_DOWNLOAD_404") return { unavailable: "unavailable", reason: "provider_not_found" };
        if (attempt === 2 || (!/TWILIO_RECORDING_DOWNLOAD_(429|5[0-9][0-9])/.test(code) && !(error instanceof Error && error.name === "TimeoutError"))) return { unavailable: "fetch_failed", reason: "provider_download_failed" };
        await new Promise(resolve => setTimeout(resolve, 250 * (attempt+1)));
      }
    }
    return { unavailable: "fetch_failed", reason: "provider_download_failed" };
  }
  async audit(id: string, actor: string, action: string) {
    await this.sql`INSERT INTO admin_telemetry_export_events(export_id,actor_user_id,action,generation)
      SELECT id,${actor},${action},generation FROM admin_telemetry_exports WHERE id=${id} AND actor_user_id=${actor}`;
  }
  async *download(actor: string, id: string, authorized: () => Promise<boolean>) {
    const initial = await this.get(actor, id);
    if (initial.status !== "ready") throw new ExportError("EXPORT_NOT_READY");
    const hash = createHash("sha256"); let total = 0, part = 0, verified = false;
    await this.audit(id, actor, "download_started");
    try {
      while (true) {
        if (!await authorized() || !await this.actorAllowed(actor)) throw new ExportError("EXPORT_FORBIDDEN", 403);
        const current = await this.get(actor, id);
        if (current.status !== "ready" || current.generation !== initial.generation) throw new ExportError("EXPORT_REVOKED");
        const [row] = await this.sql<{ payload_ciphertext: string; sha256: string; byte_count: number }[]>`SELECT p.payload_ciphertext,p.sha256,p.byte_count
          FROM admin_telemetry_export_parts p JOIN admin_telemetry_exports e ON e.id=p.export_id
          WHERE e.id=${id} AND e.status='ready' AND e.expires_at>now() AND (e.audio_deadline IS NULL OR e.audio_deadline>now())
            AND p.generation=${initial.generation} AND p.part=${part}`;
        if (!row) break;
        const buffer = Buffer.from(decryptJson<string>(row.payload_ciphertext, this.key), "base64");
        if (buffer.length !== row.byte_count || createHash("sha256").update(buffer).digest("hex") !== row.sha256) throw new ExportError("EXPORT_INTEGRITY_FAILED");
        hash.update(buffer); total += buffer.length; part++;
        if (total > initial.bytes) throw new ExportError("EXPORT_INTEGRITY_FAILED");
        if (total === initial.bytes) {
          if (hash.digest("hex") !== initial.sha256) throw new ExportError("EXPORT_INTEGRITY_FAILED");
          verified = true;
        }
        yield buffer;
        if (verified) break;
      }
      if (!verified) throw new ExportError("EXPORT_INTEGRITY_FAILED");
    } catch (error) {
      await this.audit(id, actor, "download_interrupted"); throw error;
    }
  }
  start(keepAlive = false) {
    if (this.timer) return;
    const tick = () => {
      if (this.draining || this.stopped) return;
      this.draining = this.runOnce().catch(() => writePiiSafeOperationalError("telemetry_export_worker_failed")).finally(() => { this.draining = null; });
    };
    this.timer = setInterval(tick, 2000); if (!keepAlive) this.timer.unref(); tick();
  }
  async close() {
    this.stopped = true; this.activeAbort?.abort(); if (this.timer) clearInterval(this.timer);
    await this.draining; await Promise.all([this.sql.end(), this.reader.end()]);
  }
}

export function createTelemetryExportsFromEnv() {
  if (process.env.STORAGE_DRIVER !== "postgres" || process.env.ADMIN_TELEMETRY_EXPORT_ENABLED === "false") return undefined;
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  return new TelemetryExportService(process.env.DATABASE_URL, parseDataEncryptionKeyring(process.env), createTelephonyProviderFromEnv());
}
