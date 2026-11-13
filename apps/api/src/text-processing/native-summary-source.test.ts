import {randomUUID} from "node:crypto";
import {it,expect,vi} from "vitest";
import {buildSummarySourceContext} from "./summary-source";
import {nativeAction,nativeAuthority} from "../test-helpers/native-appointment";
import type {CallTextArtifact} from "@callassist/contracts";
import type {CallRepository} from "../storage/call-repository";
it.each([8,9])("freezes native journal evidence for supported compiled schema %s",async schema=>{
 const callId=randomUUID(),attemptId=randomUUID(),compilationId=randomUUID(),sourceHash="b".repeat(64),snapshotHash="a".repeat(64),revisionId=randomUUID();
 const action=nativeAction(callId,attemptId,snapshotHash),now=new Date().toISOString();
 const compiled=schema===9?{schemaVersion:"9",nativeAppointmentAuthorization:nativeAuthority,appointmentAuthorization:null}:{schemaVersion:"8",appointmentAuthorization:{operation:"book",serviceDescription:nativeAuthority.serviceDescription,providerScope:"called_recipient",timeZone:"Europe/Zurich",windows:[{date:action.proposal.date,startTime:"09:00",endTime:"17:00"}],selection:"first_matching",maxAppointments:1,financialPolicy:"no_new_financial_terms"}};
 const repository={getTranscriptRevision:vi.fn(async()=>({id:revisionId,callAttemptId:attemptId,sourceHash})),getAttempt:vi.fn(async()=>({id:attemptId,callBriefId:callId,compilationId,compilationSnapshotHash:snapshotHash,startedAt:now,endedAt:now})),getTextArtifactSourceCompilation:vi.fn(async()=>({compiledBrief:compiled,snapshotHash,approvedAt:now})),listCallTelemetryEvents:vi.fn(async()=>[]),exportCallTextData:vi.fn(async()=>({nativeAppointmentActions:[action]}))} as unknown as CallRepository;
 const result=await buildSummarySourceContext(repository,{callId,compilationId,transcriptRevisionId:revisionId,sourceHash,generatorVersion:"summary-v8:grounded-v3:fixture"} as CallTextArtifact);
 expect(result).toMatchObject({version:2,nativeAppointmentAction:action,nativeAppointmentAuthorization:{operation:"book"}});
});
