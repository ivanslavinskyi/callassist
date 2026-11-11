import {describe,it,expect} from "vitest";
import {nativeAppointmentPrepareSchema,nativeAppointmentTools} from "./native-appointment-call";
import {validateNativeAppointment} from "../appointments/native-appointment-authorization";
import {nativeAuthority,nativeProposal} from "../test-helpers/native-appointment";

const now=new Date("2099-08-01T00:00:00Z");
describe("appointment tools bound to approved authority",()=>{
  it("cannot invent conditions, alternatives, an earliest preference or another operation for an unconditional plan",()=>{
    const schema=nativeAppointmentPrepareSchema(nativeAuthority),args={proposal:nativeProposal,intent:"request"};
    expect(schema.safeParse(args).success).toBe(true);
    for(const patch of [{requirements:[{id:"full_price_includes_mandatory_costs",recipientQuote:"Да"}]},
      {unavailableAlternatives:[{id:"preferred",recipientQuote:"No"}]},{alternativeId:"invented"},{operation:"cancel"},
      {timeZone:"Europe/London"},{selectionEvidence:"The earliest"}])
      expect(schema.safeParse({...args,proposal:{...nativeProposal,...patch}}).success).toBe(false);
    const advertised=nativeAppointmentTools(nativeAuthority)[0]!.parameters as any;
    expect(advertised.properties.proposal.properties.requirements.maxItems).toBe(0);
    expect(advertised.properties.proposal.properties.unavailableAlternatives.maxItems).toBe(0);
  });
  it("advertises approved IDs while validating conditions against the selected branch",()=>{
    const authority=structuredClone(nativeAuthority);
    authority.requirements=[{id:"common",description:"Original part",sourceText:"Original part"}];
    authority.alternatives.push({...structuredClone(authority.alternatives[0]!),id:"backup",selection:"earliest_available",
      requirements:[{id:"access",description:"Accessible room",sourceText:"Accessible room"}]});
    const proposal={...nativeProposal,alternativeId:"backup",requirements:[{id:"common",recipientQuote:"Original part."},{id:"access",recipientQuote:"Accessible room."}],
      unavailableAlternatives:[{id:"preferred",recipientQuote:"The first option is unavailable."}],selectionEvidence:"This is earliest."};
    const text="Original part. Accessible room. The first option is unavailable. This is earliest.";
    expect(nativeAppointmentPrepareSchema(authority).safeParse({proposal,intent:"request"}).success).toBe(true);
    expect(validateNativeAppointment(authority,proposal,text,now).ok).toBe(true);
    expect(validateNativeAppointment(authority,{...proposal,alternativeId:"preferred"},text,now))
      .toMatchObject({reason:"invalid_evidence_ids",validation:{category:"arguments",field:"requirements",expectedIds:["common"],receivedIds:["common","access"]}});
  });
  it.each(["book","confirm_existing","reschedule","cancel"] as const)("keeps %s authority and the existing snapshot shape",operation=>{
    const existing=operation==="book"?null:{date:nativeProposal.date,startTime:nativeProposal.startTime,reference:null};
    const alternatives=["book","reschedule"].includes(operation)?nativeAuthority.alternatives:[];
    const authority={...nativeAuthority,operation,existingAppointment:existing,alternatives};
    const before=structuredClone(authority),proposal={...nativeProposal,operation,alternativeId:alternatives.length?"preferred":null};
    expect(nativeAppointmentPrepareSchema(authority).safeParse({proposal,intent:"status_check"}).success).toBe(true);
    expect(validateNativeAppointment(authority,proposal,"",now).ok).toBe(true);
    expect(authority).toEqual(before);
  });
  it("distinguishes invalid IDs, missing arguments and unobserved quotes without treating them as a missing human answer",()=>{
    const authority={...nativeAuthority,requirements:[{id:"part",description:"Original part",sourceText:"Original part"}]};
    const check=(requirements:typeof nativeProposal.requirements)=>validateNativeAppointment(authority,{...nativeProposal,requirements},"Yes.",now);
    expect(check([{id:"invented",recipientQuote:"Yes."}])).toMatchObject({reason:"invalid_evidence_ids",validation:{category:"arguments",expectedIds:["part"]}});
    expect(check([{id:"part",recipientQuote:"Yes."},{id:"part",recipientQuote:"Yes."}])).toMatchObject({reason:"duplicate_evidence_ids"});
    expect(check([])).toMatchObject({reason:"missing_requirement_evidence",validation:{category:"evidence",field:"requirements"}});
    expect(check([{id:"part",recipientQuote:"Yes, original."}])).toMatchObject({reason:"evidence_quote_not_observed"});
    expect(check([{id:"part",recipientQuote:"Yes."}]).ok).toBe(true);
    expect(validateNativeAppointment(authority,{},"Yes.",now)).toMatchObject({reason:"invalid_arguments",validation:{category:"arguments"}});
  });
});
