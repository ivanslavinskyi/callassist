import { z } from "zod";
import { swissDestinationPhoneSchema } from "./phone";

export const recipientSuggestionSchema = z.object({
  recipientName: z.string().trim().min(2).max(160),
  phoneNumber: swissDestinationPhoneSchema,
  lastUsedAt: z.string().datetime({ offset: true })
}).strict();

export type RecipientSuggestion = z.infer<typeof recipientSuggestionSchema>;

export const recipientSuggestionListSchema = z.object({
  items: z.array(recipientSuggestionSchema)
}).strict();

export type RecipientSuggestionList = z.infer<
  typeof recipientSuggestionListSchema
>;
