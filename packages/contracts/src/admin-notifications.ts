import { z } from "zod";

export const notificationSettingsSchema = z.strictObject({
  enabled: z.boolean(), registrations: z.boolean(), calls: z.boolean(),
  recipientUserIds: z.array(z.uuid()).max(20).refine(ids => new Set(ids).size === ids.length)
}).refine(value => !value.enabled || value.recipientUserIds.length > 0, {
  message: "Select at least one recipient before enabling notifications."
});
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;
export const notificationSettingsUpdateSchema = z.strictObject({
  settings: notificationSettingsSchema, expectedRevision: z.number().int().positive(),
  reason: z.string().trim().min(3).max(500)
});
export type NotificationSettingsUpdate = z.infer<typeof notificationSettingsUpdateSchema>;
export const notificationViewSchema = z.strictObject({
  settings: notificationSettingsSchema, revision: z.number().int().positive(),
  recipients: z.array(z.strictObject({ id: z.uuid(), name: z.string(), email: z.string() })),
  deliveries: z.array(z.strictObject({
    id: z.uuid(), kind: z.enum(["registration", "call"]), sourceId: z.uuid(), recipientUserId: z.uuid(),
    status: z.enum(["queued", "processing", "accepted", "failed", "cancelled"]),
    attempts: z.number().int().nonnegative(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
    errorCode: z.string().nullable(), providerId: z.string().nullable()
  }))
});
export type NotificationView = z.infer<typeof notificationViewSchema>;
