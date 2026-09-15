"use client";

import type { CallBrief, UserRole } from "@callassist/contracts";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AppShell } from "./app-shell";
import { CreateCallForm } from "./create-call-form";
import { CallHistory } from "./call-history";
import { useUiLocale } from "./ui-locale-provider";
import type { ProfileName } from "@/lib/represented-person-defaults";

export function Dashboard({ userId, userRole, profileName }: { userId: string; userRole: UserRole; profileName: ProfileName }) {
  const router = useRouter();
  const { localizeHref } = useUiLocale();
  useEffect(() => {
    const sync = () => {
      if (location.hash === "#history") router.replace(`${localizeHref("/app/history")}${location.search}`);
    };
    sync(); window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [router, localizeHref]);

  function openBrief(brief: CallBrief) {
    router.push(localizeHref(`/app/calls/${brief.id}`));
  }

  return (
    <AppShell>
      <main className="dashboard-page" id="main-content" tabIndex={-1}>
        <div className="dashboard-grid">
          <div id="new-call">
            <CreateCallForm key={userId} headingLevel={1} onCreated={openBrief} userId={userId} userRole={userRole} profileName={profileName} />
          </div>

          <CallHistory recent />
        </div>
      </main>
    </AppShell>
  );
}
