import { z } from "zod";
import {
  accountDeletionRequestSchema,
  creditUsageSchema,
  userRoleSchema,
  userStatusSchema
} from "./account";
import { personNamePartSchema } from "./call-brief";

export const adminUserSearchSchema = z.string().trim().min(1).max(100);

export const adminUserSummarySchema = z.object({
  id: z.uuid(),
  email: z.string().email(),
  firstName: personNamePartSchema,
  lastName: personNamePartSchema,
  role: userRoleSchema,
  status: userStatusSchema,
  phoneVerified: z.boolean(),
  createdAt: z.iso.datetime(),
  lastLoginAt: z.iso.datetime().nullable()
});
export type AdminUserSummary = z.infer<typeof adminUserSummarySchema>;

export const adminUserListSchema = z.object({
  items: z.array(adminUserSummarySchema),
  nextCursor: z.string().nullable()
});
export type AdminUserList = z.infer<typeof adminUserListSchema>;

export const adminUserCreditLedgerSchema = z.object({
  user: adminUserSummarySchema,
  usage: creditUsageSchema,
  accountDeletion: accountDeletionRequestSchema.nullable()
});
export type AdminUserCreditLedger = z.infer<
  typeof adminUserCreditLedgerSchema
>;
