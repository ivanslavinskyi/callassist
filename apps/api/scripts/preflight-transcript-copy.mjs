// Run through the release environment. Always rolls back; no content is published here.
import postgres from 'postgres';
import { readFile } from 'node:fs/promises';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED');
const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
const verify = process.argv.includes('--verify');
try {
  await sql.begin(async transaction => {
    const count = async () => (await transaction`SELECT
      (SELECT count(*) FROM content_page_revisions)+(SELECT count(*) FROM content_editorial_revisions) AS n`)[0].n;
    const before = await count();
    await transaction.unsafe(await readFile(new URL('../src/db/migrations/0088_conversation_transcript_copy.sql', import.meta.url), 'utf8'));
    const after = await count();
    if (verify && before !== after) throw new Error('TRANSCRIPT_COPY_NOT_PUBLISHED');
    console.log(JSON.stringify({ check: verify ? 'transcript-copy-publication' : 'transcript-copy-preflight', ok: true, newPublications: Number(after) - Number(before) }));
    throw new Error('PREFLIGHT_ROLLBACK');
  });
} catch (error) {
  if (!(error instanceof Error) || error.message !== 'PREFLIGHT_ROLLBACK') throw error;
} finally { await sql.end(); }
