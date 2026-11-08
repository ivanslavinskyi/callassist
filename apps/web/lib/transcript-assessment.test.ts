import { describe,it,expect } from "vitest";
import { transcriptAssessment } from "./transcript-assessment";
import { buildTranscriptPdfLayout } from "./transcript-pdf-layout";
import type { CallAssessmentSummary,CallSummaryPayload } from "@callassist/contracts";
describe("first-page transcript assessment",()=>{
  const saved={status:'ready',goal:'achieved',transcriptRevisionId:'current'} as CallAssessmentSummary;
  it("uses only the assessment of the exported revision",()=>{
    expect(transcriptAssessment({locale:'ru',assessment:saved,revisionId:'current'}).status).toBe('Выполнено');
    expect(transcriptAssessment({locale:'ru',assessment:saved,revisionId:'older'}).status).toBe('Оценка недоступна');
  });
  it("distinguishes pending, missing evidence and partial analysis",()=>{
    expect(transcriptAssessment({locale:'en',pending:true}).status).toBe('Assessment in progress');
    expect(transcriptAssessment({locale:'en'}).status).toBe('Assessment unavailable');
    const summary={assessment:{goal:{status:'partial'}},evaluationCoverage:{status:'partial'}} as CallSummaryPayload;
    const result=transcriptAssessment({locale:'en',summary});expect(result.status).toBe('Partially achieved');expect(result.note).toBeTruthy();
  });
  it("places a separate unbroken assessment before the conversation",()=>{
    const result=buildTranscriptPdfLayout({title:'Transcript',description:'Saved source',variant:'Live',recipient:'Office',language:'en',metadata:[],turns:[],text:'FIRST TURN',notes:[],assessment:transcriptAssessment({locale:'en'})});
    const serialized=JSON.stringify(result.content);
    expect(serialized.indexOf('shprohli-task-assessment')).toBeLessThan(serialized.indexOf('FIRST TURN'));
    expect(serialized).toContain('"unbreakable":true');
  });
});
