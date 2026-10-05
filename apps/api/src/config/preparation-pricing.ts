import type { PreparationProfile } from "@callassist/contracts";

export const preparationPricingVersion = "openai-preparation-2026-10-05";
// USD micros per million tokens. Sources and validity documented in the rollout guide.
export const preparationRates = {
  "gpt-5.6": { input: 4_000_000, cached: 400_000, write: 5_000_000, output: 20_000_000 },
  "gpt-5.6-terra": { input: 2_000_000, cached: 200_000, write: 2_500_000, output: 12_000_000 },
  "gpt-6-luna": { input: 100_000, cached: 10_000, write: 125_000, output: 500_000 }
} as const;
/** Conservative pre-request bound: UTF-8 bytes overestimate text tokens, plus schema overhead. */
export function preparationRequestReserve(profile: PreparationProfile, requestBytes: number, maxOutputTokens: number, now = Date.now()) {
  if (!Number.isSafeInteger(requestBytes) || requestBytes < 0 || requestBytes > 200_000 ||
    !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 20_000) throw new Error("PREPARATION_REQUEST_LIMIT");
  // A promotional tariff must be reviewed before new paid requests use it past this date.
  if (profile.serviceTier === "fast" && now >= Date.parse("2026-11-22T00:00:00Z")) throw new Error("PREPARATION_PRICING_EXPIRED");
  const rates = preparationRates[profile.model];
  const multiplier = profile.serviceTier === "fast" ? 2 : 1;
  return Math.ceil(multiplier * ((requestBytes + 4096) * rates.write + maxOutputTokens * rates.output) / 1_000_000);
}
