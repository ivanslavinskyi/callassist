import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { callCompilationSchema, createApprovedExecutionSnapshot, normalizeCreateCallBriefInput } from "@callassist/contracts";
import { createCompilationSnapshotHash, hasValidCompilationSnapshotHash } from "./compilation-integrity";
import { nativeV2Session } from "../voice/live-task-context";

it.each([5,6,7])("preserves archived plan %s and rejects it as a new native approval", version => {
  const stored=JSON.parse(readFileSync(new URL("./fixtures/legacy-compiler-4.json",import.meta.url),"utf8"));
  stored.compilerVersion=`brief-compiler-${version+2}`;
  stored.compiledBrief.schemaVersion=String(version);
  stored.compiledBrief.taskInstructions="Ask the approved question and preserve all restrictions.";
  stored.compiledBrief.orderedQuestions=[];
  if(version>=6)stored.compiledBrief.appointmentAuthorization={...stored.compiledBrief.appointmentAuthorization,
    version:2,limits:{finishBy:null,maxTotalPrice:null}};
  if(version===7){
    const a=stored.compiledBrief.appointmentAuthorization,w=a.windows[0];
    stored.compiledBrief.appointmentAuthorization={version:3,operation:a.operation,serviceDescription:a.serviceDescription,
      providerScope:a.providerScope,timeZone:a.timeZone,alternatives:[{selection:"first_matching",rules:[{
        startDate:w.date,endDate:w.date,weekdays:[],excludedWeekdays:[],excludedDates:[],startTime:w.startTime,endTime:w.endTime
      }]}],maxAppointments:1,financialPolicy:a.financialPolicy,limits:a.limits};
  }
  const compilation=callCompilationSchema.parse(stored);
  compilation.snapshotHash=createCompilationSnapshotHash(compilation);
  expect(hasValidCompilationSnapshotHash(compilation)).toBe(true);
  expect(callCompilationSchema.parse(compilation)).toEqual(compilation);
  const raw=normalizeCreateCallBriefInput(compilation.rawBrief),time=compilation.approvedAt!;
  const approved=createApprovedExecutionSnapshot({compilation,brief:{...raw,id:"11111111-1111-4111-8111-111111111111",status:"ready",createdAt:time,updatedAt:time}});
  expect(approved.version).toBe(version-1);
  expect(approved.plan).toHaveProperty("taskInstructions",stored.compiledBrief.taskInstructions);
  expect(approved.plan).not.toHaveProperty("contextAppendix");
  expect(()=>nativeV2Session(approved)).toThrow("LIVE_V2_REAPPROVAL_REQUIRED");
});
