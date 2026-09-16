import { landingMessages } from "./i18n/landing-messages";
import type { UiLocale } from "./i18n/messages";
import type { SessionSnapshot } from "./session-state";

export function landingAction(session: SessionSnapshot, locale: UiLocale, guestHref: string, guestLabel: string) {
  const copy = landingMessages[locale];
  switch (session.status) {
    case "authenticated": return { kind: "link", href: `/${locale}/app`, label: copy.prepareCall } as const;
    case "anonymous": return { kind: "link", href: guestHref, label: guestLabel } as const;
    case "loading": return { kind: "loading", label: copy.checkingSession } as const;
    case "unavailable": return { kind: "retry", label: copy.retrySession, description: copy.sessionUnavailable } as const;
  }
}
