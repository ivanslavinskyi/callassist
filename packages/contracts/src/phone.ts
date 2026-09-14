import { getCountries, parsePhoneNumberFromString } from "libphonenumber-js/max";
import { z } from "zod";

export const SWISS_DESTINATION_ONLY_MESSAGE =
  "During the public beta SHPROHLI can only call Swiss phone numbers.";

export function verificationPhoneCountry(value: string): string | null {
  const phone = parsePhoneNumberFromString(value);
  return phone?.isValid() ? phone.country ?? null : null;
}
export function isPhoneCountryCode(value: string): boolean {
  return (getCountries() as string[]).includes(value);
}

function preparePhoneInput(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith("00")) return `+${trimmed.slice(2)}`;
  if (!trimmed.startsWith("+") && /^41(?:\D|\d)/.test(trimmed)) {
    return `+${trimmed}`;
  }
  return trimmed;
}

// Account contacts use international numbers; unprefixed local input defaults to CH.
// SMS destination permissions are enforced separately by the verification provider.
export function normalizeAccountPhoneNumber(value: string) {
  const phone = parsePhoneNumberFromString(preparePhoneInput(value), "CH");
  return phone?.isValid() ? phone.number : value.trim();
}

export function parseSwissDestinationPhone(value: string) {
  try {
    const phone = parsePhoneNumberFromString(preparePhoneInput(value), "CH");
    if (!phone || phone.country !== "CH" || !phone.isValid()) return null;
    return phone.number;
  } catch {
    return null;
  }
}

export function isSwissDestinationPhone(value: string) {
  return parseSwissDestinationPhone(value) !== null;
}

export function normalizeSwissDestinationPhone(value: string) {
  return parseSwissDestinationPhone(value) ?? value.trim();
}

export const swissDestinationPhoneSchema = z
  .string()
  .trim()
  .min(1, SWISS_DESTINATION_ONLY_MESSAGE)
  .max(40, SWISS_DESTINATION_ONLY_MESSAGE)
  .superRefine((value, context) => {
    if (!isSwissDestinationPhone(value)) {
      context.addIssue({
        code: "custom",
        message: SWISS_DESTINATION_ONLY_MESSAGE
      });
    }
  })
  .transform((value) => parseSwissDestinationPhone(value)!);
