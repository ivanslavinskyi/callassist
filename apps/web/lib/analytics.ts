import { analyticsSettingsSchema, type AnalyticsSettings } from "@callassist/contracts";
import { analyticsAllowed, type PrivacyPreferences } from "./privacy-preferences";

type Gtag = (...args: unknown[]) => void;
type AnalyticsWindow = Window & { dataLayer?: unknown[]; gtag?: Gtag; [key: `ga-disable-${string}`]: boolean };
let activeId: string | null = null;
let initialized = false;
const configured = new Set<string>();
let lastPage: string | null = null;

/** Never send account identifiers, query parameters, fragments or call titles to GA. */
export function analyticsPath(pathname: string): string | null {
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return null;
  const path = pathname.split(/[?#]/)[0]!;
  return path.replace(/(\/app\/calls\/)[^/]+/g, "$1detail");
}
export function configureAnalytics(settings: AnalyticsSettings, privacy: PrivacyPreferences) {
  const host = window as unknown as AnalyticsWindow;
  const parsed = analyticsSettingsSchema.safeParse(settings);
  const id = parsed.success && parsed.data.enabled && analyticsAllowed(privacy) ? parsed.data.measurementId : null;
  if (activeId === id) return;
  if (activeId) host[`ga-disable-${activeId}`] = true;
  activeId = id; lastPage = null;
  if (!id) { document.getElementById("shprohli-google-analytics")?.remove(); return; }
  host[`ga-disable-${id}`] = false;
  host.dataLayer ??= [];
  // gtag uses Arguments objects, as in Google's installation snippet.
  host.gtag ??= function () { host.dataLayer!.push(arguments); };
  if (!initialized) {
    host.gtag("consent", "default", { ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "granted" });
    host.gtag("js", new Date()); initialized = true;
  }
  if (!configured.has(id)) {
    host.gtag("config", id, { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false });
    configured.add(id);
  }
  if (!document.getElementById("shprohli-google-analytics")) {
    const script = document.createElement("script");
    script.id = "shprohli-google-analytics"; script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
    document.head.appendChild(script);
  }
}
export function trackPageView(pathname: string) {
  const path = analyticsPath(pathname);
  if (!activeId || !path || path === lastPage) return;
  const page = new URL(path, window.location.origin).href;
  (window as unknown as AnalyticsWindow).gtag?.("event", "page_view", {
    send_to: activeId, page_location: page, page_title: "SHPROHLI",
    page_referrer: lastPage ? new URL(lastPage, window.location.origin).href : ""
  });
  lastPage = path;
}
