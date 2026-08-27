import Link from "next/link";

export function Brand({ href, label }: { href: string; label: string }) {
  return (
    <Link className="brand" href={href} aria-label={label}>
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" fill="none">
          <path d="M7.5 10.2a8.6 8.6 0 0 1 14.4-2.5" />
          <path d="M24.5 21.8a8.6 8.6 0 0 1-14.4 2.5" />
          <path d="m20.2 5.2 2.2 2.6-2.8 1.7" />
          <path d="m11.8 26.8-2.2-2.6 2.8-1.7" />
          <path d="M12.3 12.4c.8 3.7 3.6 6.5 7.3 7.3l1.8-2.1c.3-.4.8-.5 1.2-.3l3 1.2c.5.2.8.7.7 1.2l-.4 3.1c-.1.7-.7 1.2-1.4 1.2C15.4 24 8 16.6 8 7.5c0-.7.5-1.3 1.2-1.4l3.1-.4c.5-.1 1 .2 1.2.7l1.2 3c.2.4.1.9-.3 1.2l-2.1 1.8Z" />
        </svg>
      </span>
      <span>CallAssist</span>
    </Link>
  );
}

