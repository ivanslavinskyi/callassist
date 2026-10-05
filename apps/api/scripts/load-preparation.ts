import "../src/config/load-env";
import { randomUUID } from "node:crypto";
import { fork, type ChildProcess } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import postgres from "postgres";
import { isolatedTestDatabase } from "../src/db/isolated-test-database";
import { PostgresCallRepository } from "../src/storage/postgres-call-repository";
import { CallService } from "../src/call-service";
import { DeterministicBriefCompiler, type BriefCompiler } from "../src/brief-compiler/brief-compiler";
import { preparationEvaluationCorpus } from "../src/brief-compiler/preparation-evaluation";

const args=process.argv.slice(2);
const integer=(name:string,fallback:number,max:number)=>{
  const value=Number(args.find(a=>a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback);
  if (!Number.isInteger(value)||value<1||value>max) throw new Error(`Invalid --${name}`);
  return value;
};
const processes=integer("processes",2,16), slots=integer("slots",4,64), batch=integer("users",10,100);
const durationSeconds=integer("duration-seconds",10,7200), providerMs=integer("provider-ms",100,30000);
const key=Buffer.alloc(32,7); // Synthetic isolated DB only.

if (args.includes("--child")) {
  const repository=new PostgresCallRepository(process.env.TEST_DATABASE_URL!,key,undefined,4);
  const base=new DeterministicBriefCompiler();
  const compiler:BriefCompiler={model:base.model,async compile(input,revision,options){
    for (const stage of ["input_moderation","compilation","language_audit","output_moderation"] as const) {
      const id=randomUUID(),start=Date.now(),model=stage.includes("moderation") ? "omni-moderation-latest" : options?.policy?.generation.model ?? "gpt-5.6";
      const reserved=await options?.beforeProviderRequest?.({clientRequestId:id,stage,operationType:stage.includes("moderation") ? "brief_moderation" : "brief_compilation",
        provider:"openai",model,startedAt:new Date(start).toISOString(),estimatedTokens:100,requestedServiceTier:"default",reserveUsdMicros:0,
        requestMetadata:{repairKind:"none",repairNumber:0,transportAttempt:1,timeoutMs:35000,remainingMs:120000}});
      if (reserved===false) throw new Error("MOCK_BUDGET_EXHAUSTED");
      for (const kind of ["dispatched","headers","first_event","response_created","first_output","terminal"] as const) {
        await delay(Math.max(1,Math.floor(providerMs/6)),undefined,{signal:options?.signal});
        await options?.checkpoint?.(id,{version:1,kind,elapsedMs:Date.now()-start,providerRequestId:null,providerResponseId:null,actualServiceTier:"default"});
      }
      await options?.afterProviderRequest?.({clientRequestId:id,stage,outcome:"succeeded",providerRequestId:null,providerResponseId:null,providerModel:model,
        statusCode:200,completedAt:new Date().toISOString(),durationMs:Date.now()-start,errorCode:null,usage:null,actualServiceTier:"default"});
    }
    return base.compile(input,revision);
  }};
  const service=new CallService(repository,undefined,()=>process.send?.({type:"job-error"}),undefined,compiler,undefined,undefined,
    {workerRole:"preparation",preparationSlots:Math.ceil(slots/processes),reviewSlots:1,durableWorkerEnabled:true,durableWorkerKeepAlive:true,
      reportDurableWorkerHeartbeat:true,liveEventMode:"disabled"});
  await service.initialize(); process.send?.({type:"ready"});
  process.once("message",async()=>{await service.close();process.disconnect();});
} else {
  const database=isolatedTestDatabase(),children:ChildProcess[]=[];
  let sql:postgres.Sql|undefined,repository:PostgresCallRepository|undefined;
  try {
    await database.setup(); sql=postgres(database.url,{max:2}); repository=new PostgresCallRepository(database.url,key,undefined,3);
    const owners=Array.from({length:batch},()=>randomUUID());
    for (const [index,id] of owners.entries()) await sql`INSERT INTO users(id,email,password_hash,phone_e164,first_name,last_name,role,status,ui_locale,created_at,phone_verified_at)
      VALUES(${id},${`${id}@example.test`},'synthetic',${`+4171${String(index).padStart(7,'0')}`},'Synthetic','Load','user','active','en',now(),now())`;
    // Local capacity test deliberately separates provider quotas from host capacity.
    await sql`UPDATE preparation_settings SET capacity=capacity || ${sql.json({generationSlots:slots,providerSlots:slots,queueLimit:Math.max(40,batch),providerRequestsPerMinute:100000,providerTokensPerMinute:1000000000})}`;
    let errors=0;
    await Promise.all(Array.from({length:processes},()=>new Promise<void>((ready,reject)=>{
      const child=fork(fileURLToPath(import.meta.url),[...args,"--child"],{execArgv:["--import","tsx"],env:{...process.env,TEST_DATABASE_URL:database.url},silent:true});
      children.push(child); child.stderr?.on("data",()=>{errors++;});
      const timer=setTimeout(()=>reject(new Error("Worker startup timed out")),30000);
      child.on("error",reject);child.on("exit",code=>{if(code)errors++;});
      child.on("message",message=>{if((message as {type:string}).type==="ready"){clearTimeout(timer);ready();}else errors++;});
    })));
    const started=Date.now(), latencies:number[]=[],queueMs:number[]=[],samples:unknown[]=[];
    let failures=0,peakActive=0;
    do {
      const enqueued=await Promise.all(owners.map(userId=>repository!.enqueueCallPreparation({userId,idempotencyKey:randomUUID(),inputFingerprint:"a".repeat(64),
        input:preparationEvaluationCorpus()[0]!.input,now:new Date().toISOString()})));
      const timeout=Date.now()+125000;
      while(true) {
        const rows=await sql`SELECT status FROM call_preparation_requests WHERE id=ANY(${enqueued.map(p=>p.id)}::uuid[])`;
        const [active]=await sql`SELECT count(*)::int AS count FROM durable_jobs WHERE work_class='preparation' AND status='running'`;
        peakActive=Math.max(peakActive,active!.count);
        if(rows.every(row=>["succeeded","failed","cancelled"].includes(row.status))) break;
        if(Date.now()>timeout) throw new Error("Load batch deadline exceeded");
        await delay(100);
      }
      for(const preparation of enqueued){const detail=await repository.getAdminCallPreparation(preparation.id);if(detail?.status!=="succeeded")failures++;
        const timing=await repository.getPreparationDiagnostics(preparation.id);if(timing.initialQueueMs!==null)queueMs.push(timing.initialQueueMs);
      }
      const rows=await sql`SELECT extract(epoch FROM(completed_at-created_at))*1000 AS ms FROM call_preparation_requests WHERE id=ANY(${enqueued.map(p=>p.id)}::uuid[])`;
      latencies.push(...rows.map(row=>Number(row.ms))); samples.push(await repository.getPreparationRuntimeStatus());
    } while(Date.now()-started<durationSeconds*1000);
    const percentile=(values:number[],p:number)=>[...values].sort((a,b)=>a-b)[Math.max(0,Math.ceil(values.length*p)-1)] ?? null;
    const report={version:1,kind:"isolated-postgres-mock-provider",paidRequests:0,liveCalls:0,capacityCertified:false,
      processes,slots,batch,providerMs,durationMs:Date.now()-started,plans:latencies.length,failures,errors,peakActive,
      totalP50Ms:percentile(latencies,.5),totalP95Ms:percentile(latencies,.95),queueP95Ms:percentile(queueMs,.95),samples};
    const directory=resolve("../../.tools/runtime");await mkdir(directory,{recursive:true});
    const path=resolve(directory,`preparation-load-${Date.now()}.json`);await writeFile(path,JSON.stringify(report,null,2),{flag:"wx"});
    console.log(JSON.stringify({...report,samples:undefined,report:path}));
    if(failures||errors||peakActive>slots)process.exitCode=1;
  } finally {
    await Promise.all(children.map(child=>new Promise<void>(done=>{
      if(child.exitCode!==null||child.signalCode!==null){done();return;}
      const timer=setTimeout(()=>child.kill(),40000);child.once("exit",()=>{clearTimeout(timer);done();});
      if(child.connected)child.send({type:"stop"});else child.kill();
    })));
    await repository?.close();await sql?.end();await database.teardown();
  }
}
