import "../config/load-env";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { parseDataEncryptionKeyring } from "../security/encryption";
import { PostgresCallRepository } from "../storage/postgres-call-repository";
import { assembleNativeTranscript } from "../storage/native-transcript";

/** Idempotent, model-free backfill. A dry run is the default. */
export async function backfillLiveTranscripts(args=process.argv.slice(2), environment=process.env) {
  if(args.some(arg=>arg!=='--execute')) throw new Error('Only --execute is accepted');
  if(!environment.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const execute=args.includes('--execute');
  const sql=postgres(environment.DATABASE_URL,{max:1,onnotice:()=>undefined});
  const repository=new PostgresCallRepository(environment.DATABASE_URL,parseDataEncryptionKeyring(environment));
  const counts={mode:execute?'execute':'dry_run',candidates:0,published:0,partial:0,unavailable:0,failed:0};
  try {
    const rows=await sql<{callId:string;attemptId:string}[]>`SELECT b.id AS "callId",a.id AS "attemptId"
      FROM call_briefs b JOIN call_attempts a ON a.call_brief_id=b.id
      WHERE b.data_deleted_at IS NULL AND a.native_transcript_capture IS NOT NULL AND a.status IN('completed','failed','stopped')
        AND a.id=(SELECT id FROM call_attempts WHERE call_brief_id=b.id ORDER BY created_at DESC,id DESC LIMIT 1)
        AND NOT EXISTS(SELECT 1 FROM final_transcripts f WHERE f.call_attempt_id=a.id AND f.artifact_kind='live' AND f.quality IS NOT NULL)
      ORDER BY a.created_at,a.id`;
    counts.candidates=rows.length;
    for(const row of rows) {
      try {
        const work=await repository.getNativeTranscriptAttemptWork(row.callId,row.attemptId);
        if(!work.capture) continue;
        const capture=work.capture.status==='collecting' ? {...work.capture,status:'incomplete' as const,sessionFinalized:false,
          issues:[...(work.capture.issues??[]),{code:'session_unconfirmed' as const}]} : work.capture;
        const result=assembleNativeTranscript(work.snapshot,capture)!;
        if(result.quality.coverage==='partial') counts.partial++;
        if(result.quality.coverage==='unavailable') counts.unavailable++;
        if(execute) {await repository.publishNativeTranscript(row.callId,row.attemptId,result);counts.published++;}
      } catch {counts.failed++;}
    }
    return counts;
  } finally {await repository.close();await sql.end();}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  backfillLiveTranscripts().then(result=>{console.log(JSON.stringify(result));if(result.failed)process.exitCode=1;})
    .catch(()=>{console.error('LIVE_TRANSCRIPT_BACKFILL_FAILED');process.exitCode=1;});
}
