import type {
  PublishedContentPage,
  PublishedFaq
} from "@callassist/contracts";
import Link from "next/link";
import { navigationPath } from "@/lib/i18n/content-routing";
import { AppShell } from "./app-shell";
import { FaqList } from "./faq-list";

export function ContentPage({
  page,
  faq = null
}: {
  page: PublishedContentPage;
  faq?: PublishedFaq | null;
}) {
  const locale = page.locale === "de" ? "de-CH" : "en-CH";
  const published = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium"
  }).format(new Date(page.revision.publishedAt));

  return (
    <AppShell>
      <main className="content-page" id="main-content" tabIndex={-1}>
        <header className="content-heading">
          <span className="eyebrow">
            {page.locale === "de" ? "Öffentliche Information" : "Public information"}
          </span>
          <h1>{page.title}</h1>
          <p>{page.summary}</p>
          <small>
            Version {page.revision.number}
            {" · "}{page.locale === "de" ? "Gültig ab" : "Effective"} {published}
          </small>
        </header>
        {page.key === "faq" && faq ? <FaqList items={faq.items} /> : (
        <div className="content-sections">
          {page.sections.map((section) => (
            <section key={section.heading}>
              <h2>{section.heading}</h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
              {section.bullets.length ? (
                <ul>
                  {section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
                </ul>
              ) : null}
              {section.links?.length ? (
                <div className="content-links">
                  {section.links.map((link) => link.kind === "email" ? (
                    <a href={`mailto:${link.address}`} key={`${link.kind}:${link.address}`}>
                      {link.label}
                    </a>
                  ) : (
                    <Link
                      href={navigationPath(page.locale, link.destination)}
                      key={`${link.kind}:${link.destination}`}
                    >
                      {link.label}
                    </Link>
                  ))}
                </div>
              ) : null}
            </section>
          ))}
        </div>
        )}
      </main>
    </AppShell>
  );
}
