import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {it,expect} from "vitest";
import {nativeAuthorityFromLegacy,uiLocales} from "@callassist/contracts";
import {NativeAppointmentDetails,CallAppointmentResult} from "./native-appointment-details";
import type {CallSummaryPayload,NativeAppointmentAction} from "@callassist/contracts";
it.each(uiLocales)("shows all actionable schedule and limit fields for review in %s",locale=>{
 const authority=nativeAuthorityFromLegacy({operation:"book",serviceDescription:"Consultation",providerScope:"called_recipient",timeZone:"Europe/Zurich",windows:[{date:"2099-09-16",startTime:"09:00",endTime:"12:00"}],selection:"first_matching",maxAppointments:1,financialPolicy:"no_new_financial_terms"});
 authority.operation="reschedule";authority.existingAppointment={date:"2099-09-10",startTime:"10:00",reference:"TEST-123"};authority.requirements=[{id:"doctor",description:"Dr Example only",sourceText:"Dr Example only"}];
 authority.limits={finishBy:{time:"13:00",dayOffset:0,inclusive:true},maxTotalPrice:{amount:150,currency:"CHF"}};
 const html=renderToStaticMarkup(<NativeAppointmentDetails authority={authority} locale={locale}/>);
 for(const value of ["Consultation","Europe/Zurich","TEST-123","09:00","12:00","13:00","150","CHF","Dr Example only"])expect(html).toContain(value);
});

const summary:CallSummaryPayload={schemaVersion:3,appointmentExtraction:{candidates:[],conditions:[]},overview:[],findings:[],nextSteps:[],unresolved:[],
 appointmentResult:{operation:"book",representedPerson:"Alex Example",date:"2026-11-25",startTime:"10:00",timeZone:"Europe/Zurich",status:"confirmed",sourceSegmentIds:["yes"]}};
it.each(uiLocales)("retains the appointment result card from conversation evidence in %s",locale=>{
 for(const operation of ["book","confirm_existing","reschedule","cancel"] as const){
  const html=renderToStaticMarkup(<CallAppointmentResult summary={{...summary,appointmentResult:{...summary.appointmentResult!,operation}}} generatorVersion="summary-v9:test" attemptId="attempt" locale={locale}/>);
  for(const value of ["Alex Example","10:00","Europe/Zurich"])expect(html).toContain(value);
  expect(html).toContain('class="review-questions"');expect(html).toContain('class="muted-text"');
 }
});
it("keeps the existing German block and does not require a journal entry",()=>{
 const html=renderToStaticMarkup(<CallAppointmentResult summary={summary} generatorVersion="summary-v9:test" attemptId="attempt" locale="de"/>);
 expect(html).toContain("Buchen · Alex Example");expect(html).toContain("Bestätigung der Gegenstelle erfasst");expect(html).toContain("keine unabhängige Kalenderprüfung");
});
it("does not create a booking block for a general or inactive conditional task",()=>{
 const {appointmentResult:_,...general}=summary;
 const action={representedPerson:"Journal",callAttemptId:"attempt",proposal:{operation:"book",date:"2026-11-24",startTime:"14:00",timeZone:"Europe/Zurich"},state:"confirmed"} as NativeAppointmentAction;
 expect(renderToStaticMarkup(<CallAppointmentResult summary={general} generatorVersion="summary-v9:test" action={action} attemptId="attempt" locale="de"/>)).toBe("");
 expect(renderToStaticMarkup(<CallAppointmentResult summary={null} generatorVersion="summary-v8:test" action={action} attemptId="attempt" locale="de"/>)).toContain("Buchen · Journal");
 expect(renderToStaticMarkup(<CallAppointmentResult summary={null} generatorVersion="summary-v8:test" action={action} attemptId="other" locale="de"/>)).toBe("");
 const html=renderToStaticMarkup(<CallAppointmentResult summary={summary} generatorVersion="summary-v9:test" action={action} attemptId="attempt" locale="de"/>);
 expect(html).toContain("Alex Example");expect(html).not.toContain("Journal");
});
