import { isUiLocale } from "@callassist/contracts";

/** Only the protected call-result route is a supported email return target. */
export function callResultReturnPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^\/([a-z]{2})\/app\/calls\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.exec(value);
  return match && isUiLocale(match[1]!) ? value : null;
}
