import { z } from "zod";
import { registrationPolicySchema } from "./beta-controls";
import { legalRevisionReferenceSchema } from "./content";

export const registrationDocumentsSchema = z.object({
  terms: legalRevisionReferenceSchema,
  acceptableUse: legalRevisionReferenceSchema,
  privacy: legalRevisionReferenceSchema.extend({ key: z.literal("privacy") })
});
export const registrationOptionsSchema = z.object({
  policy: registrationPolicySchema,
  smsCountries: z.array(z.string().regex(/^[A-Z]{2}$/)).default(["CH", "UA"]),
  documents: registrationDocumentsSchema.nullable()
});
export type RegistrationOptions = z.infer<typeof registrationOptionsSchema>;
