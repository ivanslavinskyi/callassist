import Link from "next/link";

export function Brand({ href, label }: { href: string; label: string }) {
  return (
    <Link className="brand" href={href} aria-label={label}>
      <span>SHPROHLI</span>
    </Link>
  );
}
