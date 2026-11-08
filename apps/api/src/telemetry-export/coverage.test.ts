import {describe,expect,it} from "vitest";
import {ExportCoverage} from "./coverage";
function fixture() {
 const c=new ExportCoverage();
 c.observe("call_attempts",{id:"a",call_brief_id:"c",runtime_descriptor:{runtime:"live_native_v2"},ended_at:"now",native_transcript_capture:{status:"complete"}},true);
 return c;
}
function trace(c:ExportCoverage,{drop=0,manifest=true,payload=true}={}) {
 for(const [sequence,event_type] of [[1,"session.started"],[2+drop,"session.closed"],[3+drop,"trace.manifest"]] as const){
  if(!manifest && event_type==="trace.manifest")continue;
  c.observe("live_trace_events",{call_attempt_id:"a",trace_id:"t",sequence,event_type});
  if(payload)c.observe("live_trace_payloads",{call_attempt_id:"a",trace_id:"t",sequence,payload:event_type==="trace.manifest"?{complete:true,dropped:0,sessionClosed:true,drainTimeout:false}:{}});
 }
}
describe("export coverage",()=>{
 it("does not call an observed paid session complete when its accounting operation is absent",()=>{
  const c=fixture();trace(c);
  expect(c.finish([])).toMatchObject({incompleteAttempts:1,attempts:[{trace:"complete",usage:"missing"}]});
 });
 it("detects missing manifests, sequence gaps and payload loss even when audio is complete",()=>{
  for(const options of [{manifest:false},{drop:1},{payload:false}]){
   const c=fixture();trace(c,options);const result=c.finish([{attemptId:"a",status:"included"}]);
   expect(result.incompleteAttempts).toBe(1);expect(result.attempts[0]?.trace).toBe("incomplete");
  }
 });
 it("requires final provider usage as well as a successful operation",()=>{
  const c=fixture();trace(c);c.observe("provider_operations",{id:"op",operation_type:"realtime_session",stage:"live_conversation",call_attempt_id:"a"});
  c.observe("provider_operation_results",{operation_id:"op",outcome:"succeeded"});
  c.observe("effective_provider_usage",{operation_id:"op",billable_seconds:12,raw_usage:{finalized:false}});
  expect(c.finish([]).attempts[0]?.usage).toBe("incomplete");
  c.observe("effective_provider_usage",{operation_id:"op",duration_seconds:13,billable_seconds:null,raw_usage:{finalized:true}});
  expect(c.finish([])).toMatchObject({incompleteAttempts:0,attempts:[{trace:"complete",usage:"final"}]});
 });
 it("keeps deletion and unsupported historical capture distinct from missing native data",()=>{
  const c=fixture();expect(c.finish([]).attempts[0]?.trace).toBe("missing");
  c.observe("live_attempt_privacy",{call_attempt_id:"a",state:"discarded"});
  c.observe("call_attempts",{id:"old",call_brief_id:"c",runtime_descriptor:null,ended_at:"now"});
  expect(c.finish([])).toMatchObject({incompleteAttempts:0,attempts:[{trace:"deleted",transcript:"deleted"},{trace:"legacy_unavailable"}]});
 });
});
