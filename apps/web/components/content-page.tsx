import { formatLocale, resolveUiLocale } from "@callassist/contracts";
import { systemMessages } from "@/lib/i18n/system-messages";
import { ContentLocaleNotice } from "./content-locale-notice";
import type {
  PublishedContentPage,
  PublishedFaq
} from "@callassist/contracts";
import Link from "next/link";
import { navigationPath } from "@/lib/i18n/content-routing";
import { contentLanguageDirection } from "@/lib/content-localizations";
import { AppShell } from "./app-shell";
import { FaqList } from "./faq-list";
import { ContentNavigation } from "./content-navigation";

export function ContentPage({
  page,
  faq = null
}: {
  page: PublishedContentPage;
  faq?: PublishedFaq | null;
}) {
  const locale = resolveUiLocale(page.locale);
  const copy = systemMessages[locale];
  const published = new Intl.DateTimeFormat(formatLocale(locale), {
    dateStyle: "medium", timeZone: "Europe/Zurich"
  }).format(new Date(page.revision.publishedAt));

  return (
    <AppShell>
      <ContentLocaleNotice contentLocale={page.locale} />
      <main className="content-page" id="main-content" tabIndex={-1} lang={page.locale} dir={contentLanguageDirection(page.locale)}>
        <ContentNavigation locale={page.locale} current={page.key} />
        <header className="content-heading">
          <h1>{page.title}</h1>
          <p>{page.summary}</p>
          <small>
            {copy.version} {page.revision.number}
            {" · "}{copy.effective} {published}
          </small>
        </header>
        {page.key === "faq" && faq ? <div lang={faq.locale} dir={contentLanguageDirection(faq.locale)}><FaqList items={faq.items} /></div> : (
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
