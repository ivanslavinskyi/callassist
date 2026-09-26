import { RuntimeConfigurationError, validateRuntimeEnvironment, type RuntimeProcess } from "./runtime-environment";
import { emailBrandingFromEnv } from "../auth/email-branding";
import { textCapabilitiesFromEnv } from "../text-processing/text-capabilities";
import { ANSWERING_POLICY_VERSION } from "@callassist/contracts";

export function checkDeployment(environment: NodeJS.ProcessEnv) {
  const issues: string[] = [];
  const production = { ...environment, NODE_ENV: "production" };
  for (const runtime of ["api", "worker"] satisfies RuntimeProcess[]) {
    try { validateRuntimeEnvironment(production, runtime); }
    catch (error) {
      if (error instanceof RuntimeConfigurationError) issues.push(...error.issues.map(issue => `${runtime}: ${issue}`));
      else issues.push(`${runtime}: invalid runtime configuration`);
    }
  }
  const site = publicOrigin(environment.NEXT_PUBLIC_SITE_URL);
  const api = publicOrigin(environment.NEXT_PUBLIC_API_URL);
  if (!site) issues.push("web: NEXT_PUBLIC_SITE_URL must be a public HTTPS origin");
  if (!api) issues.push("web: NEXT_PUBLIC_API_URL must be a public HTTPS origin");
  if (site && api && site !== api) issues.push("web: NEXT_PUBLIC_API_URL must equal NEXT_PUBLIC_SITE_URL so host-only session cookies reach SSR");
  const allowed = environment.WEB_ORIGIN?.split(",").map(value => value.trim()) ?? [];
  if (site && !allowed.includes(site)) issues.push("api: WEB_ORIGIN must include NEXT_PUBLIC_SITE_URL");
  const callback = publicOrigin(environment.PUBLIC_BASE_URL);
  if (site && callback === site) issues.push("ingress: use a separate PUBLIC_BASE_URL hostname for the Twilio-only listener");
  try {
    const internal = new URL(environment.INTERNAL_API_URL ?? "");
    if (!["http:", "https:"].includes(internal.protocol) || internal.username || internal.password || internal.pathname !== "/" || internal.search || internal.hash) throw new Error();
  } catch { issues.push("web: INTERNAL_API_URL must be an HTTP(S) origin without credentials or a path"); }
  try { emailBrandingFromEnv(production); } catch { issues.push("email: invalid site origin or branding configuration"); }
  for (const name of ["TEXT_ARTIFACT_GENERATION_ENABLED", "REALTIME_AGENT_HANGUP_ENABLED"]) {
    if (!["true", "false"].includes(environment[name]?.trim() ?? "")) issues.push(`${name} must be explicitly true or false`);
  }
  if (environment.TEXT_ARTIFACT_GENERATION_ENABLED === "true" && !environment.TEXT_ARTIFACT_DIRECTIONS?.trim()) {
    issues.push("TEXT_ARTIFACT_DIRECTIONS must list the accepted directions when generation is enabled");
  }
  try { textCapabilitiesFromEnv({ driver: "openai" }, environment); }
  catch { issues.push("TEXT_ARTIFACT_DIRECTIONS or its generation flag is invalid"); }
  return { configurationValid: issues.length === 0, issues: [...new Set(issues)],
    answeringPolicy: environment.TELEPHONY_DRIVER === "twilio" ? ANSWERING_POLICY_VERSION : null,
    providerTraffic: false, databaseChecked: false, publicReleaseApproved: false,
    remaining: ["Apply/check migrations", "Set USD budget and review provider allocations", "Verify edge header stripping, TLS, secure cookies, SSE and Twilio WS externally",
      "Verify API/worker deployment parity and restart recovery", "Complete provider, alert, backup/restore and support acceptance"] };
}

function publicOrigin(value?: string) {
  try {
    const url = new URL(value ?? "");
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
      /^(localhost|127\.|\[?::1\]?)/i.test(url.hostname) || url.hostname.endsWith(".localhost") || !url.hostname.includes(".")) return null;
    return url.origin;
  } catch { return null; }
}
