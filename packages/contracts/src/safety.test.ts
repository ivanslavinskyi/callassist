import { describe, expect, it } from "vitest";
import {
  recipientOptOutConfirmationSchema,
  recipientOptOutRequestSchema,
  staffRecipientSuppressionLiftSchema,
  staffRecipientSuppressionSchema
} from "./safety";

describe("recipient safety contracts", () => {
  it("normalizes Swiss opt-out phone numbers and validates SMS codes", () => {
    expect(recipientOptOutRequestSchema.parse({ phoneE164: "079 123 45 67" }))
      .toEqual({ phoneE164: "+41791234567" });
    expect(recipientOptOutConfirmationSchema.safeParse({
      phoneE164: "+41791234567",
      code: "12ab"
    }).success).toBe(false);
  });

  it("limits staff sources and requires an operational reason", () => {
    expect(staffRecipientSuppressionSchema.parse({
      phoneE164: "+41791234567",
      source: "complaint",
      reason: "Complaint received by support"
    })).toMatchObject({ source: "complaint" });
    expect(staffRecipientSuppressionSchema.safeParse({
      phoneE164: "+41791234567",
      source: "recipient_request",
      reason: "No"
    }).success).toBe(false);
    expect(staffRecipientSuppressionLiftSchema.safeParse({
      phoneE164: "+41791234567",
      reason: " "
    }).success).toBe(false);
  });
});
