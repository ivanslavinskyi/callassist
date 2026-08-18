export const e164Pattern = /^\+[1-9]\d{7,14}$/;

export function normalizePhoneNumber(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits ? `+${digits}` : "";
}

export function isE164PhoneNumber(value: string) {
  return e164Pattern.test(value);
}
