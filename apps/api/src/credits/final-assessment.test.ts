import { describe, expect, it } from "vitest";
import type { CallAssessmentDecision, SourceSegment } from "@callassist/contracts";
import { validateFinalAssessment } from "./final-assessment";

const segments: SourceSegment[] = [
  {id:"q",role:"assistant",text:"What would you like for dinner?",startSeconds:1,endSeconds:3},
  {id:"a",role:"recipient",text:"Pizza, please.",startSeconds:4,endSeconds:6}
];
const decision: CallAssessmentDecision = {
  conversation:{status:"confirmed",category:"task_answer",questionSegmentId:"q",answerSegmentId:"a",answerQuote:"Pizza"},
  goal:{status:"achieved",sourceSegmentIds:["a"]},criteria:[{id:"criterion.0",status:"achieved",sourceSegmentIds:["a"]}]
};

describe("final assessment evidence boundary",()=>{
  it("accepts an exact excerpt attributed to the recipient",()=>{
    expect(validateFinalAssessment(decision,segments,["criterion.0"])).toEqual(decision);
  });
  it.each([
    ["invented quote",(d:CallAssessmentDecision)=>{d.conversation.answerQuote="Pasta";}],
    ["foreign revision",(d:CallAssessmentDecision)=>{d.conversation.answerSegmentId="other:a";}],
    ["assistant answer",(d:CallAssessmentDecision)=>{d.conversation.answerSegmentId="q";}],
    ["recipient question",(d:CallAssessmentDecision)=>{d.conversation.questionSegmentId="a";}],
    ["empty quote",(d:CallAssessmentDecision)=>{d.conversation.answerQuote=" ";}],
    ["missing criterion",(d:CallAssessmentDecision)=>{d.criteria=[];}],
    ["replaced criterion",(d:CallAssessmentDecision)=>{d.criteria[0]!.id="criterion.9";}],
    ["assistant-only goal evidence",(d:CallAssessmentDecision)=>{d.goal.sourceSegmentIds=["q"];}],
    ["duplicate citation",(d:CallAssessmentDecision)=>{d.goal.sourceSegmentIds=["a","a"];}],
    ["foreign criterion evidence",(d:CallAssessmentDecision)=>{d.criteria[0]!.sourceSegmentIds=["other:a"];}],
    ["success with an unmet criterion",(d:CallAssessmentDecision)=>{d.criteria[0]!.status="not_achieved";}],
    ["success with no conversation",(d:CallAssessmentDecision)=>{d.conversation={status:"absent",category:"none",questionSegmentId:null,answerSegmentId:null,answerQuote:""};}]
  ] as const)("rejects %s",(_name,change)=>{
    const altered=structuredClone(decision);change(altered);
    expect(()=>validateFinalAssessment(altered,segments,["criterion.0"])).toThrow();
  });
  it("rejects reversed speaker order and unknown speaker attribution",()=>{
    expect(()=>validateFinalAssessment(decision,[...segments].reverse(),["criterion.0"])).toThrow();
    expect(()=>validateFinalAssessment(decision,segments.map(s=>s.id==="a"?{...s,role:"unknown"}:s),["criterion.0"])).toThrow();
  });
});
