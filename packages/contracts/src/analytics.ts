import { z } from "zod";
export const measurementIdPattern = /^G-[A-Z0-9]{4,20}$/;
export const analyticsSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  measurementId: z.string().trim().max(22).refine(value => !value || measurementIdPattern.test(value), "INVALID_MEASUREMENT_ID")
}).refine(value => !value.enabled || measurementIdPattern.test(value.measurementId), "MEASUREMENT_ID_REQUIRED");
export type AnalyticsSettings = z.infer<typeof analyticsSettingsSchema>;
export const defaultAnalyticsSettings: AnalyticsSettings = { enabled: false, measurementId: "" };
export const analyticsSettingsUpdateSchema = z.strictObject({
  settings: analyticsSettingsSchema, expectedRevision: z.number().int().positive()
});
export type AnalyticsSettingsView = { settings: AnalyticsSettings; revision: number };
