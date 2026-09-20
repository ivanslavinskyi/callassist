import type { UiLocale } from "@callassist/contracts";
import type { AdminOperationsOverview } from "@callassist/contracts";

export function AdminGoalAssessments({ overview, locale }: { overview: AdminOperationsOverview; locale: UiLocale }) {
  const de = locale === "de";
  const model = overview.lifecycle?.goals;
  const user = overview.userGoalFeedback;
  if (!model && !user) return null;
  const assessed = model ? model.achieved + model.partial + model.notAchieved + model.uncertain : 0;
  const rated = user ? user.yes + user.partly + user.no : 0;
  const rate = (yes: number, total: number) => total ? `${yes} / ${total} (${new Intl.NumberFormat(locale,{style:"percent",maximumFractionDigits:1}).format(yes/total)})` : "—";
  return <div className="admin-operations-split">
    {model ? <section className="admin-operations-section"><h2>{de ? "Zielerreichung · KI" : "Goal achievement · AI"}</h2>
      <p>{de ? "Bewertung des endgültigen Transkripts anhand des genehmigten Plans. Unklare Bewertungen zählen zu den bewerteten Anrufen. Guthaben und Nutzerfeedback werden separat erfasst." : "Final transcript assessed against the approved plan. Uncertain assessments are included in assessed calls. Credits and user feedback are tracked separately."}</p>
      <p><strong>{de ? "Erreicht / bewertet" : "Achieved / assessed"}: {rate(model.achieved,assessed)}</strong></p>
      <dl className="admin-operations-list">{([
        [de ? "Erreicht" : "Achieved", model.achieved], [de ? "Teilweise" : "Partly achieved", model.partial],
        [de ? "Nicht erreicht" : "Not achieved", model.notAchieved], [de ? "Unklar" : "Uncertain", model.uncertain],
        [de ? "Prüfung läuft" : "Assessment pending", model.pending], [de ? "Prüfung fehlgeschlagen" : "Assessment unavailable", model.unavailable],
        [de ? "Nicht bewertet" : "Not assessed", model.notAssessed]
      ] as const).map(([label,count])=><div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}</dl>
    </section> : null}
    {user ? <section className="admin-operations-section"><h2>{de ? "Zielerreichung · Nutzerfeedback" : "Goal achievement · user feedback"}</h2>
      <p>{de ? "Letzte Antwort des Nutzers pro Anruf. Eine Staff-Bewertung oder KI-Einschätzung ändert diese Zahlen nicht. Ohne Rückmeldung wird kein Erfolg oder Misserfolg angenommen." : "Latest user response per call. Staff reviews and AI assessments do not change these counts. Missing feedback is neither success nor failure."}</p>
      <p><strong>{de ? "Ja / Rückmeldungen" : "Yes / responses"}: {rate(user.yes,rated)}</strong></p>
      <dl className="admin-operations-list">{([
        [de ? "Ja" : "Yes",user.yes],[de ? "Teilweise" : "Partly",user.partly],[de ? "Nein" : "No",user.no],
        [de ? "Keine Rückmeldung" : "No feedback",user.notProvided]
      ] as const).map(([label,count])=><div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}</dl>
    </section> : null}
  </div>;
}
