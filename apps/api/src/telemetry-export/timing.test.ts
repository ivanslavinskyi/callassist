import {describe,expect,it} from "vitest";
import {ExportTiming} from "./timing";
describe("export host timings",()=>{
 it("keeps closing, tool delivery, context and recovery measurements distinct and bounded",()=>{
  const t=new ExportTiming();t.observe("session.started",30,{});t.observe("startup.context",40,{briefUtf8Bytes:8000,instructionCharacters:4000});
  t.observe("closing.backend_review",50,{});t.observe("completion.review_deferred",55,{});
  t.observe("response.event",60,{event:{type:"response.output_item.done",item:{type:"function_call",call_id:"tool"}}});
  t.observe("response.item.create",80,{item:{type:"function_call_output",call_id:"tool"}});
  t.observe("closing.playback",100,{phase:"drained"});t.observe("closing.hangup_requested",102,{sinceLastSpeechForwardMs:1200});t.observe("closing.hangup_completed",120,{});
  expect(t.result()).toMatchObject({traceStartToSessionStartedMs:[30],toolReadyToOutputMs:[20],lastSpeechForwardToHangupRequestMs:[1200],playbackDrainedToHangupRequestMs:[2],hangupRequestMs:[18],counters:{closingRecovery:1,backendBusyDeferrals:1},context:{briefUtf8Bytes:8000,instructionCharacters:4000}});
  for(let i=0;i<300;i++)t.observe("session.started",i,{});
  expect(t.result().traceStartToSessionStartedMs).toHaveLength(256);expect(t.result().omittedSamples).toBe(45);
 });
 it("does not equate captions, cancelled marks or a missing start with audible playback",()=>{
  const t=new ExportTiming();t.observe("session.output_transcript.delta",0,{delta:"Goodbye"});t.observe("output.first_speech_forwarded",1,{});
  t.observe("closing.playback",10,{phase:"mark_sent",mark:"a"});t.observe("closing.playback",20,{phase:"cancelled",mark:"a"});t.observe("closing.playback",30,{phase:"mark_acknowledged",mark:"a"});
  expect(t.result()).toMatchObject({admissionToFirstSpeechForwardMs:[],closingMarkRoundTripMs:[],audiblePlaybackMeasured:false});
 });
 it("pairs independent backend requests and successful playback marks",()=>{
  const t=new ExportTiming();t.observe("media.admitted",100,{});t.observe("output.first_speech_forwarded",350,{});
  t.observe("response.event",400,{event:{type:"response.created",response:{id:"r"}}});t.observe("response.event",900,{event:{type:"response.completed",response:{id:"r"}}});
  t.observe("closing.playback",1000,{phase:"mark_sent",mark:"m"});t.observe("closing.playback",1050,{phase:"mark_acknowledged",mark:"m"});
  expect(t.result()).toMatchObject({admissionToFirstSpeechForwardMs:[250],backendResponseMs:[500],closingMarkRoundTripMs:[50]});
 });
});
