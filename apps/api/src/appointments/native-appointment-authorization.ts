import { nativeAppointmentProposalSchema, nativeAppointmentRuleContains, type NativeAppointmentExecutionAuthorization,
  type NativeAppointmentProposal } from "@callassist/contracts";
import { evaluateAppointmentCalendar } from "./appointment-calendar";
import { verifyNativeTerms } from "./native-terms-evidence";
import type { NativeAppointmentTermsEvidence } from "@callassist/contracts";

export type NativeProposalCheck = {ok:true;proposal:NativeAppointmentProposal;startsAt:string;termsEvidence?:NativeAppointmentTermsEvidence}|{ok:false;reason:string};
/** Calendar/numeric authority is deterministic. Requirement/selection meaning is
 * a backend observation backed by exact recipient text, not external verification. */
export function validateNativeAppointment(authority:NativeAppointmentExecutionAuthorization,input:unknown,recipientText:string,now:Date):NativeProposalCheck {
  const parsed=nativeAppointmentProposalSchema.safeParse(input);
  const no=(reason:string):NativeProposalCheck=>({ok:false,reason});
  if(!parsed.success)return no("invalid_arguments");
  const proposal=parsed.data;
  if(proposal.operation!==authority.operation)return no("operation_mismatch");
  if(!proposal.serviceMatches||!proposal.recipientMatches)return no("party_or_service_mismatch");
  if(proposal.timeZone!==authority.timeZone)return no("time_zone_mismatch");
  if(proposal.requiresUnapprovedTerms)return no("unapproved_terms");
  const index=authority.alternatives.findIndex(a=>a.id===proposal.alternativeId),alternative=authority.alternatives[index];
  const existing=authority.existingAppointment;
  if(authority.operation==="book"||authority.operation==="reschedule") {
    if(!alternative||!alternative.rules.some(r=>nativeAppointmentRuleContains(r,proposal.date,proposal.startTime)))return no("outside_authorized_window");
  } else if(proposal.alternativeId!==null||!existing||proposal.date!==existing.date||proposal.startTime!==existing.startTime) return no("existing_appointment_mismatch");
  const supports=(quote:string)=>quote.trim().length>0 && recipientText.includes(quote);
  const requirements=[...authority.requirements,...(alternative?.requirements??[])];
  if(new Set(proposal.requirements.map(r=>r.id)).size!==proposal.requirements.length ||
    proposal.requirements.some(r=>!requirements.some(expected=>expected.id===r.id)) ||
    requirements.some(r=>!proposal.requirements.some(e=>e.id===r.id&&supports(e.recipientQuote))))return no("condition_evidence_required");
  const earlier=authority.alternatives.slice(0,Math.max(0,index));
  if(new Set(proposal.unavailableAlternatives.map(a=>a.id)).size!==proposal.unavailableAlternatives.length ||
    proposal.unavailableAlternatives.some(a=>!earlier.some(expected=>expected.id===a.id)) ||
    earlier.some(a=>!proposal.unavailableAlternatives.some(e=>e.id===a.id&&supports(e.recipientQuote))))return no("earlier_alternative_evidence_required");
  if(alternative && alternative.selection!=="first_matching" && (!proposal.selectionEvidence||!supports(proposal.selectionEvidence)))return no("selection_evidence_required");
  if(proposal.selectionEvidence&&!supports(proposal.selectionEvidence))return no("invalid_selection_evidence");
  const price=authority.limits.maxTotalPrice;
  if((proposal.totalPrice||authority.limits.finishBy) && (!proposal.termsQuote||!supports(proposal.termsQuote)))return no("terms_evidence_required");
  const terms=verifyNativeTerms(proposal,recipientText,{price:!!price,duration:!!authority.limits.finishBy});
  if(!terms.ok)return terms;
  if(price && terms.evidence?.price?.kind!=="free" && (!proposal.totalPrice||proposal.totalPrice.currency!==price.currency||proposal.totalPrice.amount>price.amount))return no("price_limit_unverified");
  if(!price&&proposal.totalPrice&&proposal.totalPrice.amount>0)return no("price_not_authorized");
  const calendar=evaluateAppointmentCalendar({authorization:{operation:"book",serviceDescription:authority.serviceDescription,
    providerScope:"called_recipient",timeZone:authority.timeZone,windows:[{date:proposal.date,startTime:proposal.startTime,endTime:proposal.startTime}],
    selection:"first_matching",maxAppointments:1,financialPolicy:"no_new_financial_terms"},
    candidate:proposal,referenceAt:Number.isFinite(now.getTime())?now.toISOString():null});
  if(!calendar.startsAt||calendar.pastAtReference!==false)return no(calendar.pastAtReference?"past_time":calendar.reason);
  if(authority.limits.finishBy) {
    if(!proposal.durationMinutes)return no("duration_required");
    const end=new Date(Date.parse(calendar.startsAt)+proposal.durationMinutes*60_000);
    const parts=new Intl.DateTimeFormat("en-CA-u-ca-iso8601-nu-latn",{timeZone:authority.timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(end);
    const part=(type:string)=>parts.find(p=>p.type===type)!.value;
    const localEnd=`${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
    const limit=authority.limits.finishBy,day=new Date(Date.parse(`${proposal.date}T00:00:00Z`)+limit.dayOffset*86_400_000).toISOString().slice(0,10);
    const boundary=`${day}T${limit.time}`;
    if(limit.inclusive?localEnd>boundary:localEnd>=boundary)return no("finish_deadline_exceeded");
  }
  return {ok:true,proposal,startsAt:calendar.startsAt,...(terms.evidence?{termsEvidence:terms.evidence}:{})};
}
