import { nativeAppointmentProposalSchema, nativeAppointmentRuleContains, type NativeAppointmentExecutionAuthorization,
  type NativeAppointmentProposal } from "@callassist/contracts";
import { evaluateAppointmentCalendar } from "./appointment-calendar";
import { verifyNativeTerms } from "./native-terms-evidence";
import type { NativeAppointmentTermsEvidence } from "@callassist/contracts";

export type NativeProposalFailure = {ok:false;reason:string;instruction:string;validation:{
  category:"arguments"|"evidence"|"authority";field:string;expectedIds?:string[];receivedIds?:string[]
}};
export type NativeProposalCheck = {ok:true;proposal:NativeAppointmentProposal;startsAt:string;termsEvidence?:NativeAppointmentTermsEvidence}|NativeProposalFailure;
/** Calendar/numeric authority is deterministic. Requirement/selection meaning is
 * a backend observation backed by exact recipient text, not external verification. */
export function validateNativeAppointment(authority:NativeAppointmentExecutionAuthorization,input:unknown,recipientText:string,now:Date):NativeProposalCheck {
  const parsed=nativeAppointmentProposalSchema.safeParse(input);
  const no=(reason:string,field="proposal",category:NativeProposalFailure["validation"]["category"]="authority",
    ids?:{expectedIds:string[];receivedIds:string[]}):NativeProposalFailure=>({ok:false,reason,validation:{category,field,...ids},
      instruction:category==="arguments"?"Repair these tool arguments using the approved authority and existing conversation. This is not missing recipient confirmation; do not ask the recipient to repeat or dictate a phrase.":
        category==="evidence"?"Locate the supporting answer in the existing conversation and correct the evidence arguments. Missing tool evidence does not mean the recipient has not answered. Clarify only a genuinely missing or conflicting fact, never ask for a prescribed phrase.":
          "This proposal is outside or does not establish the approved authority. Reuse current facts; do not expand permission or repeat a commitment."});
  if(!parsed.success)return no("invalid_arguments","proposal","arguments");
  const proposal=parsed.data;
  if(proposal.operation!==authority.operation)return no("operation_mismatch","operation");
  if(!proposal.serviceMatches||!proposal.recipientMatches)return no("party_or_service_mismatch","party");
  if(proposal.timeZone!==authority.timeZone)return no("time_zone_mismatch","timeZone");
  if(proposal.requiresUnapprovedTerms)return no("unapproved_terms","requiresUnapprovedTerms");
  const index=authority.alternatives.findIndex(a=>a.id===proposal.alternativeId),alternative=authority.alternatives[index];
  const existing=authority.existingAppointment;
  if(authority.operation==="book"||authority.operation==="reschedule") {
    if(!alternative)return no("invalid_alternative_id","alternativeId","arguments",{expectedIds:authority.alternatives.map(a=>a.id),receivedIds:proposal.alternativeId?[proposal.alternativeId]:[]});
    if(!alternative.rules.some(r=>nativeAppointmentRuleContains(r,proposal.date,proposal.startTime)))return no("outside_authorized_window","date/startTime");
  } else if(proposal.alternativeId!==null||!existing||proposal.date!==existing.date||proposal.startTime!==existing.startTime) return no("existing_appointment_mismatch","existingAppointment");
  const supports=(quote:string)=>quote.trim().length>0 && recipientText.includes(quote);
  const requirements=[...authority.requirements,...(alternative?.requirements??[])];
  const evidence=(field:"requirements"|"unavailableAlternatives",expected:Array<{id:string}>,received:Array<{id:string;recipientQuote:string}>)=>{
    const ids={expectedIds:expected.map(r=>r.id),receivedIds:received.map(r=>r.id)};
    if(new Set(ids.receivedIds).size!==ids.receivedIds.length)return no("duplicate_evidence_ids",field,"arguments",ids);
    if(ids.receivedIds.some(id=>!ids.expectedIds.includes(id)))return no("invalid_evidence_ids",field,"arguments",ids);
    if(ids.expectedIds.some(id=>!ids.receivedIds.includes(id)))return no(field==="requirements"?"missing_requirement_evidence":"earlier_alternative_evidence_required",field,"evidence",ids);
    if(received.some(r=>!supports(r.recipientQuote)))return no("evidence_quote_not_observed",field,"evidence",ids);
    return null;
  };
  const requirementError=evidence("requirements",requirements,proposal.requirements);if(requirementError)return requirementError;
  const earlier=authority.alternatives.slice(0,Math.max(0,index));
  const alternativeError=evidence("unavailableAlternatives",earlier,proposal.unavailableAlternatives);if(alternativeError)return alternativeError;
  if(alternative && alternative.selection!=="first_matching" && (!proposal.selectionEvidence||!supports(proposal.selectionEvidence)))return no("selection_evidence_required","selectionEvidence","evidence");
  if(proposal.selectionEvidence&&!supports(proposal.selectionEvidence))return no("invalid_selection_evidence","selectionEvidence","evidence");
  const price=authority.limits.maxTotalPrice;
  if((proposal.totalPrice||authority.limits.finishBy) && (!proposal.termsQuote||!supports(proposal.termsQuote)))return no("terms_evidence_required","termsQuote","evidence");
  const terms=verifyNativeTerms(proposal,recipientText,{price:!!price,duration:!!authority.limits.finishBy});
  if(!terms.ok)return no(terms.reason,"termsQuote","evidence");
  if(price && terms.evidence?.price?.kind!=="free" && (!proposal.totalPrice||proposal.totalPrice.currency!==price.currency||proposal.totalPrice.amount>price.amount))return no("price_limit_unverified","totalPrice");
  if(!price&&proposal.totalPrice&&proposal.totalPrice.amount>0)return no("price_not_authorized","totalPrice");
  const calendar=evaluateAppointmentCalendar({authorization:{operation:"book",serviceDescription:authority.serviceDescription,
    providerScope:"called_recipient",timeZone:authority.timeZone,windows:[{date:proposal.date,startTime:proposal.startTime,endTime:proposal.startTime}],
    selection:"first_matching",maxAppointments:1,financialPolicy:"no_new_financial_terms"},
    candidate:proposal,referenceAt:Number.isFinite(now.getTime())?now.toISOString():null});
  if(!calendar.startsAt||calendar.pastAtReference!==false)return no(calendar.pastAtReference?"past_time":calendar.reason);
  if(authority.limits.finishBy) {
    if(!proposal.durationMinutes)return no("duration_required","durationMinutes","evidence");
    const end=new Date(Date.parse(calendar.startsAt)+proposal.durationMinutes*60_000);
    const parts=new Intl.DateTimeFormat("en-CA-u-ca-iso8601-nu-latn",{timeZone:authority.timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(end);
    const part=(type:string)=>parts.find(p=>p.type===type)!.value;
    const localEnd=`${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
    const limit=authority.limits.finishBy,day=new Date(Date.parse(`${proposal.date}T00:00:00Z`)+limit.dayOffset*86_400_000).toISOString().slice(0,10);
    const boundary=`${day}T${limit.time}`;
    if(limit.inclusive?localEnd>boundary:localEnd>=boundary)return no("finish_deadline_exceeded","durationMinutes");
  }
  return {ok:true,proposal,startsAt:calendar.startsAt,...(terms.evidence?{termsEvidence:terms.evidence}:{})};
}
