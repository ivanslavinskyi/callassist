import { isIP } from "node:net";

export class ProxyConfigurationError extends Error {
  constructor() {
    super("TRUSTED_PROXY_CIDRS must contain explicit IP addresses/CIDRs, or none for direct ingress");
    this.name = "ProxyConfigurationError";
  }
}

/** Never infer trust from hop count or broad named networks. The edge must strip
 * incoming forwarding headers, and only the reviewed proxy peers belong here. */
export function trustedProxyPolicy(value?: string): false | string[] {
  if (!value?.trim() || value.trim() === "none") return false;
  const entries = value.split(",").map(entry => entry.trim());
  if (entries.length > 32 || entries.some(entry => {
    const [address, prefix, extra] = entry.split("/");
    const family = isIP(address ?? "");
    return !family || extra !== undefined || (prefix !== undefined &&
      (!/^\d+$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > (family === 4 ? 32 : 128)));
  })) throw new ProxyConfigurationError();
  return [...new Set(entries)];
}

export function twilioWebhookHost(environment: NodeJS.ProcessEnv = process.env) {
  const host = environment.TWILIO_WEBHOOK_HOST?.trim() || "127.0.0.1";
  if (!isIP(host)) throw new Error("TWILIO_WEBHOOK_HOST must be a literal IP address");
  return host;
}

export function apiHost(environment: NodeJS.ProcessEnv = process.env) {
  const host = environment.API_HOST?.trim() ||
    (environment.NODE_ENV === "production" ? "127.0.0.1" : "0.0.0.0");
  if (!isIP(host)) throw new Error("API_HOST must be a literal IP address");
  return host;
}
