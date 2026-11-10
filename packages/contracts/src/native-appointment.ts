import { z } from "zod";
import { appointmentDateSchema, appointmentTimeSchema, appointmentTimeZoneSchema, type AppointmentAuthorization } from "./appointment";
import { appointmentDateRuleSchema, appointmentLimitsSchema, appointmentRuleContains } from "./archived-appointment";

const identifier = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
export const nativeAppointmentOperationSchema = z.enum(["book", "confirm_existing", "reschedule", "cancel"]);
export const nativeExistingAppointmentSchema = z.strictObject({
  date: appointmentDateSchema, startTime: appointmentTimeSchema,
  reference: z.string().trim().min(1).max(160).nullable()
});
export const nativeAppointmentRequirementSchema = z.strictObject({
  id: identifier, description: z.string().trim().min(2).max(400), sourceText: z.string().trim().min(1).max(1000)
});
export const nativeAppointmentAlternativeSchema = z.strictObject({
  id: identifier, selection: z.enum(["first_matching", "earliest_day", "earliest_available"]),
  rules: z.array(appointmentDateRuleSchema).min(1).max(31),
  requirements: z.array(nativeAppointmentRequirementSchema).max(12)
});
/** New, explicitly approved authority. Archived permissions are never promoted to it. */
export const nativeAppointmentAuthorizationSchema = z.strictObject({
  version: z.literal(1), operation: nativeAppointmentOperationSchema,
  serviceDescription: z.string().trim().min(2).max(400), providerScope: z.literal("called_recipient"),
  timeZone: appointmentTimeZoneSchema, existingAppointment: nativeExistingAppointmentSchema.nullable(),
  alternatives: z.array(nativeAppointmentAlternativeSchema).max(8),
  requirements: z.array(nativeAppointmentRequirementSchema).max(12),
  limits: appointmentLimitsSchema, maxAppointments: z.literal(1), financialPolicy: z.literal("no_unapproved_terms")
}).superRefine(validateNativeAuthority);
function validateNativeAuthority(value: {
  operation: string; existingAppointment: unknown; requirements: Array<{id:string}>;
  alternatives: Array<{id:string;requirements:Array<{id:string}>}>
}, context: z.RefinementCtx) {
  const requiresExisting = value.operation !== "book";
  if (requiresExisting !== (value.existingAppointment !== null)) context.addIssue({code:"custom",path:["existingAppointment"],message:"An existing appointment is required only for confirmation, rescheduling or cancellation"});
  const needsAlternatives = value.operation === "book" || value.operation === "reschedule";
  if (needsAlternatives !== (value.alternatives.length > 0)) context.addIssue({code:"custom",path:["alternatives"],message:"Only booking and rescheduling require approved alternatives"});
  const ids = value.alternatives.map(item=>item.id);
  if (new Set(ids).size !== ids.length) context.addIssue({code:"custom",path:["alternatives"],message:"Alternative IDs must be unique"});
  for (const requirements of [value.requirements,...value.alternatives.map(item=>[...value.requirements,...item.requirements])])
    if(new Set(requirements.map(item=>item.id)).size!==requirements.length) context.addIssue({code:"custom",path:["requirements"],message:"Requirement IDs must be unique within an alternative"});

}
/** Runtime requirements deliberately exclude compiler source quotations. */
export const nativeAppointmentExecutionAuthorizationSchema = z.strictObject({
  ...nativeAppointmentAuthorizationSchema.shape,
  requirements: z.array(nativeAppointmentRequirementSchema.omit({sourceText:true})).max(12),
  alternatives: z.array(nativeAppointmentAlternativeSchema.extend({
    requirements: z.array(nativeAppointmentRequirementSchema.omit({sourceText:true})).max(12)
  })).max(8)
}).superRefine(validateNativeAuthority);
export type NativeAppointmentExecutionAuthorization = z.infer<typeof nativeAppointmentExecutionAuthorizationSchema>;
export function nativeExecutionAuthority(value: NativeAppointmentAuthorization): NativeAppointmentExecutionAuthorization {
  const requirement = ({id,description}: {id:string;description:string}) => ({id,description});
  return nativeAppointmentExecutionAuthorizationSchema.parse({...value,
    requirements:value.requirements.map(requirement),
    alternatives:value.alternatives.map(a=>({...a,requirements:a.requirements.map(requirement)}))});
}

export type NativeAppointmentAuthorization = z.infer<typeof nativeAppointmentAuthorizationSchema>;
export type NativeAppointmentOperation = z.infer<typeof nativeAppointmentOperationSchema>;
export const nativeAppointmentProposalSchema = z.strictObject({
  operation: nativeAppointmentOperationSchema, alternativeId: identifier.nullable(),
  date: appointmentDateSchema, startTime: appointmentTimeSchema, timeZone: appointmentTimeZoneSchema,
  serviceMatches: z.boolean(), recipientMatches: z.boolean(), requiresUnapprovedTerms: z.boolean(),
  totalPrice: z.strictObject({amount:z.number().finite().min(0).max(1_000_000_000),currency:z.string().regex(/^[A-Z]{3}$/)}).nullable(),
  durationMinutes: z.number().int().min(1).max(44_640).nullable(),
  termsQuote: z.string().min(1).max(2000).nullable(),
  requirements: z.array(z.strictObject({id:identifier,recipientQuote:z.string().min(1).max(2000)})).max(24),
  unavailableAlternatives: z.array(z.strictObject({id:identifier,recipientQuote:z.string().min(1).max(2000)})).max(7),
  selectionEvidence: z.string().min(1).max(2000).nullable()
});
export type NativeAppointmentProposal = z.infer<typeof nativeAppointmentProposalSchema>;

export function nativeAuthorityFromLegacy(value: AppointmentAuthorization): NativeAppointmentAuthorization {
  return nativeAppointmentAuthorizationSchema.parse({version:1,operation:value.operation,serviceDescription:value.serviceDescription,
    providerScope:value.providerScope,timeZone:value.timeZone,existingAppointment:value.operation==="confirm_existing"
      ? {date:value.windows[0]!.date,startTime:value.windows[0]!.startTime,reference:null}:null,
    alternatives:value.operation==="book"?[{id:"approved",selection:value.selection,requirements:[],rules:value.windows.map(window=>({
      startDate:window.date,endDate:window.date,weekdays:[],excludedWeekdays:[],excludedDates:[],startTime:window.startTime,endTime:window.endTime
    }))}]:[],requirements:[],limits:{finishBy:null,maxTotalPrice:null},maxAppointments:1,financialPolicy:"no_unapproved_terms"});
}
export { appointmentRuleContains as nativeAppointmentRuleContains };

export const nativeAppointmentTermsEvidenceSchema=z.strictObject({version:z.literal(1),source:z.literal("recipient_statement"),
  recipientTextHash:z.string().regex(/^[a-f0-9]{64}$/),quote:z.string().min(1).max(2000),start:z.number().int().nonnegative(),end:z.number().int().positive(),
  price:z.union([z.strictObject({kind:z.literal("amount"),amount:z.number().finite().nonnegative(),currency:z.string().regex(/^[A-Z]{3}$/)}),
    z.strictObject({kind:z.literal("free"),amount:z.literal(0),currency:z.null()})]).nullable(),durationMinutes:z.number().positive().nullable()});
export type NativeAppointmentTermsEvidence=z.infer<typeof nativeAppointmentTermsEvidenceSchema>;

export const nativeAppointmentActionSchema = z.strictObject({
  schemaVersion:z.literal(1),id:z.uuid(),callBriefId:z.uuid(),callAttemptId:z.uuid(),revision:z.number().int().positive(),
  snapshotHash:z.string().regex(/^[a-f0-9]{64}$/),proposalHash:z.string().regex(/^[a-f0-9]{64}$/),
  representedPerson:z.string().min(1).max(200),proposal:nativeAppointmentProposalSchema,
  termsEvidence:nativeAppointmentTermsEvidenceSchema.optional(),
  state:z.enum(["authorized","delivered","uncertain","confirmed","declined"]),
  intent:z.enum(["request","status_check"]),episode:z.number().int().min(1).max(10),
  delivery:z.strictObject({status:z.enum(["not_observed","played","interrupted"]),mark:z.string().max(160).nullable(),
    assistantQuote:z.string().max(8000).nullable(),observedAt:z.iso.datetime().nullable()}),
  confirmation:z.strictObject({recipientQuote:z.string().min(1).max(8000),observedAt:z.iso.datetime(),
    source:z.literal("recipient_statement"),independentlyVerified:z.literal(false)}).nullable(),
  authorizedAt:z.iso.datetime(),updatedAt:z.iso.datetime()
});
export type NativeAppointmentAction = z.infer<typeof nativeAppointmentActionSchema>;

export function nativeActionTransitionAllowed(previous:NativeAppointmentAction|null,next:NativeAppointmentAction) {
  if(!previous)return next.revision===1 && next.state==="authorized" && next.episode===1;
  if(next.revision!==previous.revision+1 || next.callAttemptId!==previous.callAttemptId || next.callBriefId!==previous.callBriefId || next.snapshotHash!==previous.snapshotHash)return false;
  if(next.id!==previous.id||next.proposalHash!==previous.proposalHash)
    return previous.state==="declined" && next.state==="authorized" && next.episode===1;
  if(next.state==="authorized" && previous.state!=="authorized")
    return ["uncertain","delivered"].includes(previous.state) && next.intent==="status_check" && next.episode===previous.episode+1;
  if(next.episode!==previous.episode || next.intent!==previous.intent)return false;
  if(next.state==="confirmed")return previous.state==="delivered" && next.delivery.status==="played" && next.confirmation!==null;
  return (previous.state==="authorized" && ["delivered","uncertain","declined"].includes(next.state)) ||
    (previous.state==="delivered" && ["uncertain","declined"].includes(next.state)) ||
    (previous.state==="uncertain" && next.state==="declined") ||
    (previous.state==="confirmed" && next.state==="uncertain");
}
