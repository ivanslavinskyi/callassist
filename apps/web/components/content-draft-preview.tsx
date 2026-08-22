import type { AdminContentLocalizedRevision } from "@callassist/contracts";
import Link from "next/link";
import { AppShell } from "./app-shell";

export function ContentDraftPreview({
  page,
  interfaceLocale
}: {
  page: AdminContentLocalizedRevision;
  interfaceLocale: "en" | "de";
}) {
  const isGerman = interfaceLocale === "de";
  const updated = new Intl.DateTimeFormat(isGerman ? "de-CH" : "en-CH", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(page.revision.updatedAt));

  return (
    <AppShell>
      <main className="content-page content-draft-preview" id="main-content" tabIndex={-1}>
        <div className="content-preview-banner" role="status">
          <div>
            <strong>{isGerman ? "Private Entwurfsvorschau" : "Private draft preview"}</strong>
            <span>{isGerman ? "Nicht öffentlich sichtbar" : "Not visible to the public"}</span>
          </div>
          <Link href={`/${interfaceLocale}/admin/content`}>
            {isGerman ? "Zurück zum Editor" : "Back to editor"}
          </Link>
        </div>
        <header className="content-heading">
          <span className="eyebrow">{page.locale.toUpperCase()} · {page.slug}</span>
          <h1>{page.title}</h1>
          <p>{page.summary}</p>
          <small>
            {isGerman ? "Entwurf" : "Draft"} {page.revision.number} · {updated}
          </small>
        </header>
        <div className="content-sections">
          {page.sections.map((section, index) => (
            <section key={`${section.heading}-${index}`}>
              <h2>{section.heading}</h2>
              {section.paragraphs.map((paragraph, paragraphIndex) => (
                <p key={`${paragraph}-${paragraphIndex}`}>{paragraph}</p>
              ))}
              {section.bullets.length ? (
                <ul>
                  {section.bullets.map((bullet, bulletIndex) => (
                    <li key={`${bullet}-${bulletIndex}`}>{bullet}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </div>
      </main>
    </AppShell>
  );
}
