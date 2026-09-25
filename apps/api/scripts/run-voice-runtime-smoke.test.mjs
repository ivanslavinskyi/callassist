import { it as test } from "vitest";
import assert from "node:assert/strict";
import { assessVoiceSmoke, runVoiceRuntimeSmoke } from "./run-voice-runtime-smoke.mjs";
const facts = { completed:true,consent:true,hangup:true,finalTranscript:true,retentionComplete:true,realtimeUsage:true,
  liveFinalUsage:true,backendUsage:true,nativeInput:true,nativeOutput:true,liveSessions:1,unfinishedOperations:0 };
test("live smoke requires native evidence and never passes on fallback",()=>{
  assert.deepEqual(assessVoiceSmoke(facts,"live"),[]);
  assert.ok(assessVoiceSmoke({...facts,liveFinalUsage:false},"live").includes("live_final_usage_missing_or_fallback_used"));
  assert.ok(assessVoiceSmoke({...facts,backendUsage:false},"live").includes("responses_usage_missing"));
});
test("realtime smoke must contain no Live session and both require the retained post-call pipeline",()=>{
  assert.deepEqual(assessVoiceSmoke({...facts,liveSessions:0},"realtime"),[]);
  assert.ok(assessVoiceSmoke({...facts,finalTranscript:false},"realtime").includes("post_call_transcript_missing"));
  assert.ok(assessVoiceSmoke(facts,"realtime").includes("unexpected_live_session"));
});
test("smoke refuses accidental remote targets and invalid driver before requests",async()=>{
  await assert.rejects(()=>runVoiceRuntimeSmoke({VOICE_SMOKE_DRIVER:"live",REAL_CALL_DRILL_API_URL:"https://example.com"}),/local API/);
  await assert.rejects(()=>runVoiceRuntimeSmoke({VOICE_SMOKE_DRIVER:"typo"}),/VOICE_SMOKE_DRIVER/);
});
test("verification uses the requested call and emits a compact report without transcripts",async()=>{
  const report=await runVoiceRuntimeSmoke({VOICE_SMOKE_DRIVER:"live",VOICE_SMOKE_MODE:"verify",REAL_CALL_DRILL_CALL_ID:"00000000-0000-4000-8000-000000000001"},
    {readFacts:async()=>facts,write:()=>{}});
  assert.equal(report.passed,true);
});
