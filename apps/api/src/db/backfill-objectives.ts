import "../config/load-env";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { decryptJson, encryptJson, parseDataEncryptionKeyring } from "../security/encryption";
/** New writes are encrypted before this resumable backfill. Never log task content. */
export async function backfillObjectives(args=process.argv.slice(2),env=process.env) {
  if(args.some(arg=>arg!=="--execute")) throw new Error("Only --execute is accepted");
  if(!env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const sql=postgres(env.DATABASE_URL,{max:1,onnotice:()=>undefined}),key=parseDataEncryptionKeyring(env);
  let updated=0;
  try {
    const [count]=await sql<{count:number}[]>`SELECT count(*)::int AS count FROM call_briefs WHERE objective_ciphertext IS NULL AND data_deleted_at IS NULL`;
    if(args.includes("--execute")) for(;;) {
      const batch=await sql.begin(async tx=>{
        const rows=await tx<{id:string;objective:string}[]>`SELECT id,objective FROM call_briefs WHERE objective_ciphertext IS NULL AND data_deleted_at IS NULL ORDER BY id LIMIT 100 FOR UPDATE`;
        for(const row of rows) {
          const ciphertext=encryptJson(row.objective,key);
          if(decryptJson(ciphertext,key)!==row.objective) throw new Error("OBJECTIVE_VERIFICATION_FAILED");
          await tx`UPDATE call_briefs SET objective_ciphertext=${ciphertext},objective='Encrypted task' WHERE id=${row.id} AND data_deleted_at IS NULL`;
        }
        return rows.length;
      }); updated+=batch; if(!batch) break;
    }
    return {mode:args.includes("--execute")?"execute":"dry_run",candidates:count!.count,updated};
  } finally{await sql.end();}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  backfillObjectives().then(result=>console.log(JSON.stringify(result))).catch(()=>{console.error("OBJECTIVE_BACKFILL_FAILED");process.exitCode=1;});
}
