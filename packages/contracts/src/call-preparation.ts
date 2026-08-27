import { z } from "zod";

export const callPreparationStatusSchema = z.enum([
  "queued",
  "processing",
  "retrying",
  "succeeded",
  "failed",
  "cancelled"
]);
export type CallPreparationStatus = z.infer<
  typeof callPreparationStatusSchema
>;

export const callPreparationFailureCodeSchema = z.enum([
  "BRIEF_COMPILER_UNAVAILABLE",
  "BRIEF_COMPILER_RESPONSE_INVALID",
  "BRIEF_COMPILATION_FAILED"
]);
export type CallPreparationFailureCode = z.infer<
  typeof callPreparationFailureCodeSchema
>;

export const callPreparationSchema = z.strictObject({
  id: z.uuid(),
  status: callPreparationStatusSchema,
  callBriefId: z.uuid().nullable(),
  failureCode: callPreparationFailureCodeSchema.nullable(),
  attemptCount: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable()
}).superRefine((preparation, context) => {
  const terminal = ["succeeded", "failed", "cancelled"].includes(
    preparation.status
  );
  if (terminal !== (preparation.completedAt !== null)) {
    context.addIssue({
      code: "custom",
      message: "Terminal preparation state must have a completion timestamp"
    });
  }
  if ((preparation.status === "succeeded") !== (preparation.callBriefId !== null)) {
    context.addIssue({
      code: "custom",
      message: "Only a succeeded preparation may reference a call brief"
    });
  }
  if ((preparation.status === "failed") !== (preparation.failureCode !== null)) {
    context.addIssue({
      code: "custom",
      message: "Only a failed preparation must expose a failure code"
    });
  }
});
export type CallPreparation = z.infer<typeof callPreparationSchema>;
