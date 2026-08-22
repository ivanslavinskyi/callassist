import "../config/load-env";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { OwnerCallFeedbackInput } from "@callassist/contracts";
import postgres from "postgres";
import {
  dataEncryptionActiveKeyId,
  decryptJson,
  encryptedPayloadKeyId,
  encryptJson,
  parseDataEncryptionKeyring,
  type DataEncryptionKeyring
} from "../security/encryption";
import { createCallFeedbackFingerprint } from "../security/feedback-fingerprint";
import { runMigrations } from "./migrate";

const rotationLockId = 742_303_985;
const genericCiphertextColumns = [
  ["call_briefs", "allowed_facts_ciphertext"],
  ["call_briefs", "context_ciphertext"],
  ["call_briefs", "compilation_ciphertext"],
  ["call_briefs", "assistance_reason_ciphertext"],
  ["call_briefs", "assistance_disclosure_ciphertext"],
  ["final_transcripts", "text_ciphertext"],
  ["final_transcripts", "segments_ciphertext"]
] as const;

type CiphertextRow = { id: string; payload: string };
type FeedbackRow = {
  id: string;
  goalResult: OwnerCallFeedbackInput["goalResult"];
  transcriptQuality: OwnerCallFeedbackInput["transcriptQuality"];
  commentCiphertext: string | null;
  payloadFingerprint: string;
  payloadFingerprintKeyId: string;
  idempotencyKey: string;
};

export function parseReencryptionBatchSize(value: string | undefined) {
  const parsed = value === undefined || value.trim() === ""
    ? 100
    : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
    throw new Error("DATA_ENCRYPTION_REENCRYPT_BATCH_SIZE must be 1..500");
  }
  return parsed;
}

export function assertReencryptionConfirmation(
  confirmation: string | undefined,
  activeKeyId: string
) {
  if (confirmation?.trim() !== activeKeyId) {
    throw new Error(
      "DATA_ENCRYPTION_REENCRYPT_CONFIRM must equal the active key ID"
    );
  }
}

export async function reencryptDatabase(
  environment: NodeJS.ProcessEnv = process.env
) {
  const startedAt = Date.now();
  const databaseUrl = environment.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const keyring = parseDataEncryptionKeyring(environment);
  const activeKeyId = dataEncryptionActiveKeyId(keyring);
  assertReencryptionConfirmation(
    environment.DATA_ENCRYPTION_REENCRYPT_CONFIRM,
    activeKeyId
  );
  const batchSize = parseReencryptionBatchSize(
    environment.DATA_ENCRYPTION_REENCRYPT_BATCH_SIZE
  );
  await runMigrations(databaseUrl);
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  let lockAcquired = false;
  let rewrittenCiphertexts = 0;
  let rewrittenFeedbackRows = 0;

  try {
    const [lock] = await sql<{ acquired: boolean }[]>`
      SELECT pg_try_advisory_lock(${rotationLockId}) AS acquired
    `;
    if (!lock?.acquired) {
      throw new Error("Another data encryption rotation is already running");
    }
    lockAcquired = true;

    for (const [table, column] of genericCiphertextColumns) {
      rewrittenCiphertexts += await reencryptGenericColumn(
        sql,
        table,
        column,
        keyring,
        batchSize
      );
    }
    const feedbackResult = await reencryptFeedback(
      sql,
      keyring,
      batchSize
    );
    rewrittenCiphertexts += feedbackResult.rewrittenCiphertexts;
    rewrittenFeedbackRows += feedbackResult.rewrittenRows;
    const verification = await verifyRotation(sql, keyring, batchSize);

    return {
      event: "data_encryption_reencryption_succeeded",
      schemaVersion: 1,
      runId: randomUUID(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      activeKeyId,
      batchSize,
      ciphertextFamilies: genericCiphertextColumns.length + 1,
      rewrittenCiphertexts,
      rewrittenFeedbackRows,
      verifiedCiphertexts: verification.verifiedCiphertexts,
      verifiedFeedbackFingerprints: verification.verifiedFeedbackFingerprints,
      remainingNonActiveCiphertexts: 0,
      remainingNonActiveFeedbackFingerprints: 0
    };
  } finally {
    if (lockAcquired) {
      await sql`SELECT pg_advisory_unlock(${rotationLockId})`;
    }
    await sql.end();
  }
}

async function reencryptGenericColumn(
  sql: postgres.Sql,
  table: string,
  column: string,
  keyring: DataEncryptionKeyring,
  batchSize: number
) {
  let rewritten = 0;
  while (true) {
    const changed = await sql.begin(async (transaction) => {
      const rows = await transaction.unsafe<CiphertextRow[]>(`
        SELECT id::text AS id, ${quoteIdentifier(column)} AS payload
        FROM ${quoteIdentifier(table)}
        WHERE ${quoteIdentifier(column)} IS NOT NULL
          AND (
            split_part(${quoteIdentifier(column)}, ':', 1) <> 'v2'
            OR split_part(${quoteIdentifier(column)}, ':', 2) <> $1
          )
        ORDER BY id
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      `, [keyring.activeKeyId, batchSize]);
      for (const row of rows) {
        const plaintext = decryptJson<unknown>(row.payload, keyring);
        const encrypted = encryptJson(plaintext, keyring);
        const updated = await transaction.unsafe<{ id: string }[]>(`
          UPDATE ${quoteIdentifier(table)}
          SET ${quoteIdentifier(column)} = $1
          WHERE id = $2::uuid AND ${quoteIdentifier(column)} = $3
          RETURNING id::text AS id
        `, [encrypted, row.id, row.payload]);
        if (updated.length !== 1) {
          throw new Error("Concurrent ciphertext update prevented re-encryption");
        }
      }
      return rows.length;
    });
    rewritten += changed;
    if (changed < batchSize) return rewritten;
  }
}

async function reencryptFeedback(
  sql: postgres.Sql,
  keyring: DataEncryptionKeyring,
  batchSize: number
) {
  let rewrittenRows = 0;
  let rewrittenCiphertexts = 0;
  while (true) {
    const changed = await sql.begin(async (transaction) => {
      await transaction`
        SELECT set_config('callassist.encryption_rotation', 'enabled', true)
      `;
      const rows = await transaction.unsafe<FeedbackRow[]>(`
        SELECT
          id::text AS id,
          goal_result AS "goalResult",
          transcript_quality AS "transcriptQuality",
          comment_ciphertext AS "commentCiphertext",
          payload_fingerprint AS "payloadFingerprint",
          payload_fingerprint_key_id AS "payloadFingerprintKeyId",
          idempotency_key::text AS "idempotencyKey"
        FROM call_feedback_revisions
        WHERE payload_fingerprint_key_id <> $1
          OR (
            comment_ciphertext IS NOT NULL
            AND (
              split_part(comment_ciphertext, ':', 1) <> 'v2'
              OR split_part(comment_ciphertext, ':', 2) <> $1
            )
          )
        ORDER BY id
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      `, [keyring.activeKeyId, batchSize]);
      let changedCiphertexts = 0;
      for (const row of rows) {
        const comment = row.commentCiphertext
          ? decryptJson<string>(row.commentCiphertext, keyring)
          : null;
        const input: OwnerCallFeedbackInput = {
          goalResult: row.goalResult,
          transcriptQuality: row.transcriptQuality,
          comment,
          idempotencyKey: row.idempotencyKey
        };
        assertFingerprint(
          row.payloadFingerprint,
          createCallFeedbackFingerprint(
            input,
            keyring,
            row.payloadFingerprintKeyId
          )
        );
        const commentCiphertext = comment === null
          ? null
          : encryptedPayloadKeyId(row.commentCiphertext!) === keyring.activeKeyId
            ? row.commentCiphertext
            : encryptJson(comment, keyring);
        if (commentCiphertext !== row.commentCiphertext) changedCiphertexts += 1;
        const fingerprint = createCallFeedbackFingerprint(input, keyring);
        const updated = await transaction.unsafe<{ id: string }[]>(`
          UPDATE call_feedback_revisions
          SET
            comment_ciphertext = $1,
            payload_fingerprint = $2,
            payload_fingerprint_key_id = $3
          WHERE id = $4::uuid
            AND comment_ciphertext IS NOT DISTINCT FROM $5
            AND payload_fingerprint = $6
            AND payload_fingerprint_key_id = $7
          RETURNING id::text AS id
        `, [
          commentCiphertext,
          fingerprint,
          keyring.activeKeyId,
          row.id,
          row.commentCiphertext,
          row.payloadFingerprint,
          row.payloadFingerprintKeyId
        ]);
        if (updated.length !== 1) {
          throw new Error("Concurrent feedback update prevented re-encryption");
        }
      }
      return { rows: rows.length, ciphertexts: changedCiphertexts };
    });
    rewrittenRows += changed.rows;
    rewrittenCiphertexts += changed.ciphertexts;
    if (changed.rows < batchSize) {
      return { rewrittenRows, rewrittenCiphertexts };
    }
  }
}

async function verifyRotation(
  sql: postgres.Sql,
  keyring: DataEncryptionKeyring,
  batchSize: number
) {
  let verifiedCiphertexts = 0;
  for (const [table, column] of genericCiphertextColumns) {
    verifiedCiphertexts += await verifyCiphertextColumn(
      sql,
      table,
      column,
      keyring,
      batchSize
    );
  }
  let verifiedFeedbackFingerprints = 0;
  let cursor: string | null = null;
  while (true) {
    const rows: FeedbackRow[] = await sql.unsafe<FeedbackRow[]>(`
      SELECT
        id::text AS id,
        goal_result AS "goalResult",
        transcript_quality AS "transcriptQuality",
        comment_ciphertext AS "commentCiphertext",
        payload_fingerprint AS "payloadFingerprint",
        payload_fingerprint_key_id AS "payloadFingerprintKeyId",
        idempotency_key::text AS "idempotencyKey"
      FROM call_feedback_revisions
      WHERE ($1::uuid IS NULL OR id > $1::uuid)
      ORDER BY id
      LIMIT $2
    `, [cursor, batchSize]);
    for (const row of rows) {
      if (row.payloadFingerprintKeyId !== keyring.activeKeyId) {
        throw new Error("Non-active feedback fingerprint remains after re-encryption");
      }
      const comment = row.commentCiphertext
        ? decryptJson<string>(row.commentCiphertext, keyring)
        : null;
      if (
        row.commentCiphertext &&
        encryptedPayloadKeyId(row.commentCiphertext) !== keyring.activeKeyId
      ) {
        throw new Error("Non-active feedback ciphertext remains after re-encryption");
      }
      if (row.commentCiphertext) verifiedCiphertexts += 1;
      assertFingerprint(
        row.payloadFingerprint,
        createCallFeedbackFingerprint({
          goalResult: row.goalResult,
          transcriptQuality: row.transcriptQuality,
          comment,
          idempotencyKey: row.idempotencyKey
        }, keyring)
      );
      verifiedFeedbackFingerprints += 1;
    }
    if (rows.length < batchSize) break;
    cursor = rows.at(-1)!.id;
  }
  return { verifiedCiphertexts, verifiedFeedbackFingerprints };
}

async function verifyCiphertextColumn(
  sql: postgres.Sql,
  table: string,
  column: string,
  keyring: DataEncryptionKeyring,
  batchSize: number
) {
  let verified = 0;
  let cursor: string | null = null;
  while (true) {
    const rows: CiphertextRow[] = await sql.unsafe<CiphertextRow[]>(`
      SELECT id::text AS id, ${quoteIdentifier(column)} AS payload
      FROM ${quoteIdentifier(table)}
      WHERE ${quoteIdentifier(column)} IS NOT NULL
        AND ($1::uuid IS NULL OR id > $1::uuid)
      ORDER BY id
      LIMIT $2
    `, [cursor, batchSize]);
    for (const row of rows) {
      if (encryptedPayloadKeyId(row.payload) !== keyring.activeKeyId) {
        throw new Error("Non-active ciphertext remains after re-encryption");
      }
      decryptJson<unknown>(row.payload, keyring);
      verified += 1;
    }
    if (rows.length < batchSize) break;
    cursor = rows.at(-1)!.id;
  }
  return verified;
}

function assertFingerprint(actual: string, expected: string) {
  const actualBuffer = /^[a-f0-9]{64}$/.test(actual)
    ? Buffer.from(actual, "hex")
    : Buffer.alloc(0);
  const expectedBuffer = Buffer.from(expected, "hex");
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new Error("Stored feedback fingerprint verification failed");
  }
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

const isEntrypoint =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  try {
    const evidence = await reencryptDatabase();
    process.stdout.write(`${JSON.stringify(evidence)}\n`);
  } catch {
    process.stderr.write(`${JSON.stringify({
      event: "data_encryption_reencryption_failed",
      errorCode: "REENCRYPTION_FAILED"
    })}\n`);
    process.exitCode = 1;
  }
}
