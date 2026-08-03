import { z } from "zod";
import {
  approvalRequestSchema,
  callBriefSchema,
  callLocaleSchema,
  transcriptSegmentSchema
} from "./call-brief";

export const callEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("call.updated"),
    brief: callBriefSchema
  }),
  z.object({
    type: z.literal("transcript.added"),
    segment: transcriptSegmentSchema
  }),
  z.object({
    type: z.literal("transcript.delta"),
    key: z.string().min(1),
    role: z.enum(["assistant", "recipient"]),
    delta: z.string(),
    locale: callLocaleSchema
  }),
  z.object({
    type: z.literal("approval.requested"),
    approval: approvalRequestSchema
  }),
  z.object({
    type: z.literal("approval.resolved"),
    approval: approvalRequestSchema
  })
]);

export type CallEvent = z.infer<typeof callEventSchema>;
