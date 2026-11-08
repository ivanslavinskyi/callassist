import { z } from "zod";
import { supportedUiLocaleSchema } from "./languages";
export const testingAccessSchema = z.strictObject({ enabled: z.boolean(), byRole: z.boolean(), revision: z.number().int().nonnegative() });
export type TestingAccess = z.infer<typeof testingAccessSchema>;
export const testingAccessUpdateSchema = z.strictObject({ enabled: z.boolean(), expectedRevision: z.number().int().nonnegative() });
export const testScenarioInputSchema = z.strictObject({
  title: z.string().trim().min(1).max(80), objective: z.string().trim().min(10).max(4000),
  locale: supportedUiLocaleSchema, status: z.enum(["draft", "active", "archived"]), sortOrder: z.number().int().min(0).max(10000)
});
export const testScenarioSchema = testScenarioInputSchema.extend({ id: z.uuid(), revision: z.number().int().positive(), updatedAt: z.iso.datetime() });
export const testScenarioUpdateSchema = testScenarioInputSchema.extend({ expectedRevision: z.number().int().nonnegative() });
export const testScenarioSelectionSchema = z.strictObject({ id: z.uuid(), revision: z.number().int().positive() });
export type TestScenario = z.infer<typeof testScenarioSchema>;
export type TestScenarioInput = z.infer<typeof testScenarioInputSchema>;
export type TestScenarioSelection = z.infer<typeof testScenarioSelectionSchema>;
export const testingAttributionSchema = z.strictObject({
  tester: z.boolean(), byRole: z.boolean(), scenario: testScenarioSelectionSchema.nullable(), objectiveModified: z.boolean().nullable()
});
export type TestingAttribution = z.infer<typeof testingAttributionSchema>;
