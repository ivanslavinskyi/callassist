import { z } from "zod";
import { createCallBriefInputSchema } from "./call-brief";
import { taskLanguagePreferencesSchema } from "./languages";

export const callPreparationRequestV2Schema = z.strictObject({
  requestVersion: z.literal(2),
  brief: createCallBriefInputSchema,
  languagePreferences: taskLanguagePreferencesSchema
});
export const callPreparationRequestSchema = z.union([
  callPreparationRequestV2Schema, createCallBriefInputSchema
]);
export type CallPreparationRequest = z.infer<typeof callPreparationRequestSchema>;

/** Preserve useful field errors for legacy clients while validating the v2 envelope strictly. */
export function safeParseCallPreparationRequest(value: unknown) {
  return value && typeof value === "object" && "requestVersion" in value
    ? callPreparationRequestV2Schema.safeParse(value)
    : createCallBriefInputSchema.safeParse(value);
}
