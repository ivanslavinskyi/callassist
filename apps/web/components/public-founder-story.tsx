import Image from "next/image";
import { landingMessages } from "@/lib/i18n/landing-messages";
import { useUiLocale } from "./ui-locale-provider";
import styles from "./public-founder-story.module.css";

export function PublicFounderStory({ headingId }: { headingId: string }) {
  const { locale } = useUiLocale();
  const founder = landingMessages[locale].founder;

  return (
    <section className={`public-section ${styles.story}`} aria-labelledby={headingId} lang={locale} dir="ltr">
      <header className={styles.heading}>
        <span className="eyebrow">{founder.eyebrow}</span>
        <h2 id={headingId}>{founder.title}</h2>
      </header>
      <div className={styles.portrait}>
        <Image
          src="/brand/ivan-slavinskyi.jpg"
          alt={founder.name}
          fill
          sizes="336px"
          className={styles.photo}
        />
      </div>
      <div className={styles.copy}>
        {founder.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        <p className={styles.signature}>
          <strong>{founder.name}</strong>
          <span>{founder.role}</span>
        </p>
      </div>
    </section>
  );
}
