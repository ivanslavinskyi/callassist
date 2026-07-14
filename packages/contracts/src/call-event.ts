import { z } from "zod";
import {
  approvalRequestSchema,
  callBriefSchema,
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
    type: z.literal("approval.requested"),
    approval: approvalRequestSchema
  }),
  z.object({
    type: z.literal("approval.resolved"),
    approval: approvalRequestSchema
  })
]);

export type CallEvent = z.infer<typeof callEventSchema>;
