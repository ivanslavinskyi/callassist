import Link from "next/link";
import type { UiLocale } from "@/lib/i18n/messages";
import { landingAction } from "@/lib/landing-action";
import { useSession } from "./session-provider";

export function LandingPrimaryAction({ locale, guestHref, guestLabel, sessionAware, className }: {
  locale: UiLocale;
  guestHref: string;
  guestLabel: string;
  sessionAware: boolean;
  className: string;
}) {
  const { session, refreshSession } = useSession();
  const action = landingAction(sessionAware ? session : { status: "anonymous" }, locale, guestHref, guestLabel);
  if (action.kind === "link") {
    return <Link className={className} href={action.href} prefetch={false} lang={locale}>{action.label}</Link>;
  }
  return <button
    className={className}
    type="button"
    lang={locale}
    disabled={action.kind === "loading"}
    aria-busy={action.kind === "loading"}
    title={action.kind === "retry" ? action.description : undefined}
    aria-label={action.kind === "retry" ? `${action.description} ${action.label}` : undefined}
    onClick={() => void refreshSession()}
  >{action.label}</button>;
}
