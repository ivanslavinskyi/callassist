import { z } from "zod";

export const serviceLivenessSchema = z.strictObject({
  status: z.literal("alive")
});
export type ServiceLiveness = z.infer<typeof serviceLivenessSchema>;

export const serviceReadinessSchema = z.strictObject({
  status: z.enum(["ready", "not_ready"]),
  checks: z.strictObject({
    database: z.enum(["ready", "unavailable"])
  })
});
export type ServiceReadiness = z.infer<typeof serviceReadinessSchema>;
