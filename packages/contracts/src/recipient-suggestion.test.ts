import { describe, expect, it } from "vitest";
import { recipientSuggestionListSchema } from "./recipient-suggestion";

describe("recipient suggestion contracts", () => {
  it("accepts a minimal Swiss recipient-history response", () => {
    expect(recipientSuggestionListSchema.parse({
      items: [{
        recipientName: "Dr. Schmidt",
        phoneNumber: "044 123 45 67",
        lastUsedAt: "2026-08-20T10:30:00.000Z"
      }]
    })).toEqual({
      items: [{
        recipientName: "Dr. Schmidt",
        phoneNumber: "+41441234567",
        lastUsedAt: "2026-08-20T10:30:00.000Z"
      }]
    });
  });

  it("rejects foreign numbers and extra call content", () => {
    expect(recipientSuggestionListSchema.safeParse({
      items: [{
        recipientName: "Example Office",
        phoneNumber: "+442079460000",
        lastUsedAt: "2026-08-20T10:30:00.000Z"
      }]
    }).success).toBe(false);
    expect(recipientSuggestionListSchema.safeParse({
      items: [{
        recipientName: "Example Office",
        phoneNumber: "+41441234567",
        lastUsedAt: "2026-08-20T10:30:00.000Z",
        objective: "Private call objective"
      }]
    }).success).toBe(false);
  });
});
