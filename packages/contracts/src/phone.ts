import { getCountries, getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";
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

export function parseAccountPhoneNumber(value: string, country: string = "CH"): string | null {
  if (!isPhoneCountryCode(country) || value.length > 40 || !/^[+\d\s().-]+$/.test(value.trim())) return null;
  const compact = value.trim().replace(/[\s().-]/g, "");
  const input = compact.startsWith("00") ? `+${compact.slice(2)}` : compact;
  const selected = country as CountryCode;
  const parse = (text: string) => {
    const phone = parsePhoneNumberFromString(text, { defaultCountry: selected, extract: false });
    return phone?.isValid() && !phone.ext ? phone : null;
  };
  if (input.startsWith("+")) return parse(input)?.number ?? null;
  const national = parse(input);
  const international = input.startsWith(getCountryCallingCode(selected)) ? parse(`+${input}`) : null;
  const candidates = new Set([national, international].filter(phone => phone?.country === selected).map(phone => phone!.number));
  return candidates.size === 1 ? [...candidates][0]! : null;
}

export function normalizeAccountPhoneNumber(value: string, country = "CH") {
  return parseAccountPhoneNumber(value, country) ?? value.trim();
}

export function parseSwissDestinationPhone(value: string) {
  try {
    const normalized = parseAccountPhoneNumber(value, "CH");
    const phone = normalized ? parsePhoneNumberFromString(normalized) : null;
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
