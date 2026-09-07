import Image from "next/image";
import Link from "next/link";

export function Brand({ href, label }: { href: string; label: string }) {
  return <Link className="brand" href={href} aria-label={label}>
    <Image className="brand-light" src="/brand/logo-light.svg" width={184} height={31} alt="" priority />
    <Image className="brand-dark" src="/brand/logo-dark.svg" width={184} height={31} alt="" priority />
  </Link>;
}
