import { describe, expect, it } from "vitest";
import type { CallBrief, CallSummaryPayload } from "@callassist/contracts";
import { summaryExportLines, summaryPresentation } from "./summary-presentation";
import { buildDerivedTranscriptCopyText, buildDerivedTranscriptPdfDefinition, type DerivedTranscriptExport } from "./derived-transcript-export";

const summary: CallSummaryPayload = { schemaVersion:3,appointmentExtraction:{candidates:[],conditions:[{checkId:"time",kind:"calendar_only",candidateId:null}]},
  overview:[{label:"Итог",text:"Собеседник подтвердил запись.",findingIds:["goal"]}],findings:[
    {id:"goal",label:"Запись",text:"Собеседник подтвердил запись.",certainty:"reported",sourceSegmentIds:["answer"]},
    {id:"time",label:"Время",text:"Согласовано время.",certainty:"reported",sourceSegmentIds:["answer"]}],nextSteps:[],unresolved:[],
  calendar:{version:"appointment-calendar-v1",contextHash:"a".repeat(64),candidateId:null,eligibility:"within",reason:"exact_window",windowIndex:0,
    startsAt:"2026-10-03T09:00:00Z",pastAtReference:false,sourceSegmentIds:["answer"],label:"Допустимое время",
    text:"3 октября, 11:00. Дата и время соответствуют утверждённому расписанию.",sourceLabel:"Утверждённое расписание",sourceText:"3 октября, 09:00–18:00",
    actionState:"unconfirmed",actionText:"Подтверждение действия в приложении не завершено."}};
describe("shared summary projection",()=>{
  it("keeps computed evidence separate from conversation certainty and shows it once",()=>{
    expect(summaryPresentation(summary).findings.map(f=>f.id)).toEqual(["goal"]);
    const lines=summaryExportLines(summary);
    expect(lines.filter(l=>l.includes("соответствуют"))).toHaveLength(1);
    expect(lines).toContain(summary.calendar!.actionText);
    expect(lines.some(l=>l.includes("неизвестно"))).toBe(false);
  });
  it("includes the same calendar and action statements in copied text and PDF",()=>{
    const input: DerivedTranscriptExport={brief:{recipientName:"Пример",locale:"ru-RU"} as CallBrief,
      revision:{revision:1,id:"rev",transcriptId:"transcript",callAttemptId:"attempt",sourceHash:"b".repeat(64),createdAt:"2026-10-01T08:12:00Z",text:"Да, подтверждаю.",segments:[]},
      segments:[],text:"Да, подтверждаю.",translationLanguage:null,uiLocale:"ru",summary};
    const text=buildDerivedTranscriptCopyText(input),pdf=JSON.stringify(buildDerivedTranscriptPdfDefinition(input));
    for(const phrase of [summary.calendar!.text,summary.calendar!.sourceText,summary.calendar!.actionText]) {
      expect(text).toContain(phrase);expect(pdf).toContain(phrase);
    }
  });
});
