import type postgres from "postgres";
import { callLanguageContextSchema, resolveTaskLanguage, type CallCompilation, type CallLanguageContext, type TextLanguage } from "@callassist/contracts";
import { CallRepositoryError, type PreparationLanguageOptions } from "./call-repository";

type Executor = postgres.Sql | postgres.TransactionSql;

export async function storePreparationLanguage(sql: Executor, preparationId: string, language?: PreparationLanguageOptions) {
  if (!language) return;
  await sql`
    INSERT INTO call_preparation_language_contexts (preparation_id, preferences, account_preference)
    VALUES (${preparationId}, ${sql.json(language.preferences ?? { mode: "auto" })}, ${language.accountPreference ?? null})
    ON CONFLICT (preparation_id) DO NOTHING
  `;
}

export async function readLanguageContext(sql: Executor, callId: string): Promise<CallLanguageContext | null> {
  const [row] = await sql<{ context: unknown }[]>`SELECT context FROM call_language_contexts WHERE call_brief_id = ${callId}`;
  return row ? callLanguageContextSchema.parse(row.context) : null;
}

export async function publishLanguageContext(sql: Executor, callId: string, compilation: CallCompilation, preparationId?: string) {
  const [prepared] = preparationId ? await sql<Array<{ preferences: PreparationLanguageOptions["preferences"]; accountPreference: TextLanguage | null }>>`
    SELECT preferences, account_preference AS "accountPreference" FROM call_preparation_language_contexts WHERE preparation_id = ${preparationId}
  ` : [];
  const previous = await readLanguageContext(sql, callId);
  const context = resolveTaskLanguage({
    preferences: prepared?.preferences, accountPreference: prepared?.accountPreference,
    detectedLanguage: compilation.compiledBrief?.sourceLanguage,
    compilationRevision: compilation.revision, previous
  });
  await sql`
    INSERT INTO call_language_contexts (call_brief_id, context) VALUES (${callId}, ${sql.json(context)})
    ON CONFLICT (call_brief_id) DO UPDATE SET context = EXCLUDED.context, updated_at = now()
  `;
}

export async function changeContentLanguage(sql: postgres.Sql, callId: string, language: TextLanguage, expectedRevision: number) {
  return sql.begin(async transaction => {
    const [call] = await transaction<{ id: string; approved: boolean }[]>`
      SELECT id, EXISTS(SELECT 1 FROM call_compilation_approvals a WHERE a.compilation_id = call_briefs.current_compilation_id) AS approved
      FROM call_briefs WHERE id = ${callId} AND data_deleted_at IS NULL FOR UPDATE
    `;
    if (!call) throw new CallRepositoryError("CALL_NOT_FOUND");
    if (call.approved) throw new CallRepositoryError("CALL_LANGUAGE_LOCKED");
    const previous = await readLanguageContext(transaction, callId);
    if (!previous || previous.selectionRevision !== expectedRevision) throw new CallRepositoryError("CALL_LANGUAGE_STALE");
    const context: CallLanguageContext = { ...previous, taskContentLanguage: language, selectionSource: "task", selectionRevision: previous.selectionRevision + 1 };
    await transaction`UPDATE call_language_contexts SET context = ${transaction.json(context)}, updated_at = now() WHERE call_brief_id = ${callId}`;
    return context;
  });
}
