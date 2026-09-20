import Image from "next/image";
import Link from "next/link";
import { uiLocaleRegistry, DEFAULT_UI_LOCALE, type UiLocale } from "@callassist/contracts";

export function Brand({ href, label, locale = DEFAULT_UI_LOCALE }: { href: string; label: string; locale?: UiLocale }) {
  return <Link className="brand" href={href} aria-label={`${label}. ${uiLocaleRegistry[locale].slogan}`}>
    <span className="brand-wordmark">
    <Image className="brand-light" src="/brand/logo-light.svg" width={184} height={31} alt="" priority />
    <Image className="brand-dark" src="/brand/logo-dark.svg" width={184} height={31} alt="" priority />
    </span>
    <span className="brand-slogan" lang={locale}>{uiLocaleRegistry[locale].slogan}</span>
  </Link>;
}
