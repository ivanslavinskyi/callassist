import type { PublishedFaq } from "@callassist/contracts";

export function FaqList({ items }: { items: PublishedFaq["items"] }) {
  return (
    <div className="content-sections faq-list">
      {items.map((item) => (
        <section key={item.id}>
          <h2>{item.question}</h2>
          {item.answer.split(/\n{2,}/).map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </section>
      ))}
    </div>
  );
}
