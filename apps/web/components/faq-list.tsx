import type { PublishedFaq } from "@callassist/contracts";

export function FaqList({ items }: { items: PublishedFaq["items"] }) {
  return (
    <div className="content-sections faq-list">
      {items.map((item) => (
        <details key={item.id}>
          <summary>{item.question}</summary>
          {item.answer.split(/\n{2,}/).map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </details>
      ))}
    </div>
  );
}
