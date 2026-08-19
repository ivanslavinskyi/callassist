import {
  isSwissDestinationPhone,
  normalizeSwissDestinationPhone
} from "@callassist/contracts";

export function normalizePhoneNumber(value: string) {
  return normalizeSwissDestinationPhone(value);
}

export function isE164PhoneNumber(value: string) {
  return isSwissDestinationPhone(value);
}
