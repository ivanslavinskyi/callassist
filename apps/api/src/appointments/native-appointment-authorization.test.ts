import { describe,it,expect } from "vitest";
import { nativeAuthority,nativeProposal } from "../test-helpers/native-appointment";
import { validateNativeAppointment } from "./native-appointment-authorization";
const now=new Date("2099-08-01T00:00:00Z");
const check=(authority=nativeAuthority,proposal=nativeProposal,text="")=>validateNativeAppointment(authority,proposal,text,now);
describe("native appointment authority",()=>{
 it("accepts a future matching slot but rejects guessed service, parties, terms and time zone",()=>{
  expect(check()).toMatchObject({ok:true,startsAt:"2099-09-16T13:00:00.000Z"});
  for(const patch of [{serviceMatches:false},{recipientMatches:false},{requiresUnapprovedTerms:true},{timeZone:"Europe/London"},{startTime:"18:00"}])expect(check(nativeAuthority,{...nativeProposal,...patch}).ok).toBe(false);
 });
 it("preserves open-ended ranges and excluded weekdays/dates",()=>{
  const a=structuredClone(nativeAuthority);a.alternatives[0]!.rules[0]!.endDate=null;
  expect(check(a,{...nativeProposal,date:"2101-09-16"}).ok).toBe(true);
  a.alternatives[0]!.rules[0]!.excludedDates=[nativeProposal.date];expect(check(a).ok).toBe(false);
  a.alternatives[0]!.rules[0]!.excludedDates=[];a.alternatives[0]!.rules[0]!.excludedWeekdays=[new Date(nativeProposal.date).getUTCDay()||7];expect(check(a).ok).toBe(false);
 });
 it("requires observed evidence for common conditions, branch conditions, fallback and earliest selection",()=>{
  const a=structuredClone(nativeAuthority);a.requirements=[{id:"doctor",description:"Only Dr Example",sourceText:"Only Dr Example"}];
  a.alternatives.push({...structuredClone(a.alternatives[0]!),id:"backup",selection:"earliest_available",requirements:[{id:"access",description:"Accessible room",sourceText:"Accessible room"}]});
  const p={...nativeProposal,alternativeId:"backup",requirements:[{id:"doctor",recipientQuote:"Dr Example is available."},{id:"access",recipientQuote:"The room is accessible."}],unavailableAlternatives:[{id:"preferred",recipientQuote:"No preferred slots remain."}],selectionEvidence:"This is the earliest slot."};
  const text="Dr Example is available.The room is accessible.No preferred slots remain.This is the earliest slot.";
  expect(check(a,p,text).ok).toBe(true);expect(check(a,p,text.replace("The room is accessible.","")).ok).toBe(false);
  expect(check(a,{...p,unavailableAlternatives:[]},text)).toMatchObject({reason:"earlier_alternative_evidence_required"});
  expect(check(a,{...p,selectionEvidence:null},text)).toMatchObject({reason:"selection_evidence_required"});
 });
 it("checks numeric price, currency, duration and finish deadline",()=>{
  const a=structuredClone(nativeAuthority);a.limits={finishBy:{time:"16:00",dayOffset:0,inclusive:true},maxTotalPrice:{amount:150,currency:"CHF"}};
  const p={...nativeProposal,totalPrice:{amount:120,currency:"CHF"},durationMinutes:60,termsQuote:"One hour, 120 francs total."};
  expect(check(a,p,p.termsQuote).ok).toBe(true);
  for(const patch of [{durationMinutes:61},{totalPrice:{amount:151,currency:"CHF"}},{totalPrice:{amount:120,currency:"EUR"}},{durationMinutes:null},{termsQuote:null}])expect(check(a,{...p,...patch},p.termsQuote).ok).toBe(false);
  expect(check(nativeAuthority,p,p.termsQuote)).toMatchObject({reason:"price_not_authorized"});
 });
 it.each(["confirm_existing","cancel"] as const)("%s is bound to one existing appointment",operation=>{
  const a={...nativeAuthority,operation,alternatives:[],existingAppointment:{date:nativeProposal.date,startTime:nativeProposal.startTime,reference:"ABC"}};
  expect(check(a,{...nativeProposal,operation,alternativeId:null}).ok).toBe(true);
  expect(check(a,{...nativeProposal,operation,alternativeId:null,startTime:"16:00"}).ok).toBe(false);
 });
 it("rejects past, nonexistent and ambiguous local times",()=>{
  for(const [date,startTime] of [["2026-03-29","02:30"],["2026-10-25","02:30"],["2025-09-01","12:00"]]){
   const a=structuredClone(nativeAuthority);a.alternatives[0]!.rules=[{...a.alternatives[0]!.rules[0]!,startDate:"2025-01-01",endDate:null,startTime:"00:00",endTime:"23:59"}];
   expect(validateNativeAppointment(a,{...nativeProposal,date:date!,startTime:startTime!},"",new Date("2026-01-01T00:00:00Z")).ok).toBe(false);
  }
 });
});
