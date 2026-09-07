from pathlib import Path
import re, shutil, xml.etree.ElementTree as ET
R=Path(__file__).resolve().parents[1].parent
D=Path(__file__).resolve().parent
C=R/'apps/web/components'
A=R/'apps/web/public/brand';A.mkdir(parents=True,exist_ok=True)
for name in ['logo-light.svg','logo-dark.svg']:
 shutil.copyfile(D/'assets'/name,A/name)
variants=[]
for name in ['sun','moon','bars-3','x-mark']:
 root=ET.fromstring((D/f'assets/heroicons/{name}.svg').read_text())
 paths=[]
 for child in root:
  attrs=' '.join(f'{ {"stroke-linecap":"strokeLinecap","stroke-linejoin":"strokeLinejoin"}.get(k,k)}="{v}"' for k,v in child.attrib.items())
  paths.append('<path '+attrs+' />')
 variants.append(f'  "{name}": <>'+''.join(paths)+'</>')
(C/'ui-icon.tsx').write_text('''// Heroicons 2.2.0 Outline, unchanged source paths. MIT: public/brand/heroicons-LICENSE.
const icons = {
'''+',\n'.join(variants)+'''
};
export function UiIcon({name, className = ""}: {name: keyof typeof icons; className?: string}) {
  return <svg className={`ui-icon ${className}`} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" focusable="false">{icons[name]}</svg>;
}
''',encoding='utf-8')
shutil.copyfile(D/'assets/heroicons/LICENSE',A/'heroicons-LICENSE')
shutil.copyfile(D/'assets/heroicons/provenance.json',A/'heroicons-provenance.json')
(C/'brand.tsx').write_text('''import Image from "next/image";
import Link from "next/link";

export function Brand({ href, label }: { href: string; label: string }) {
  return <Link className="brand" href={href} aria-label={label}>
    <Image className="brand-light" src="/brand/logo-light.svg" width={184} height={31} alt="" priority />
    <Image className="brand-dark" src="/brand/logo-dark.svg" width={184} height={31} alt="" priority />
  </Link>;
}
''',encoding='utf-8')
p=C/'app-shell.tsx';s=p.read_text(encoding='utf-8')
s=s.replace('import { Brand } from "./brand";', '''import { Brand } from "./brand";
import { ThemeToggle } from "./theme-toggle";
import { NavigationMenu } from "./navigation-menu";
import { SiteFooter } from "./site-footer";
import { designMessages } from "@/lib/i18n/design-messages";''')
s=s.replace('  const [theme, setTheme] = useState<"light" | "dark">("light");\n','')
s=re.sub(r'  useEffect\(\(\) => \{\n    setTheme.*?\n  \}, \[\]\);\n','',s,flags=re.S)
s=s[:s.index('  function toggleTheme()')]+'''  function changeLocale(nextLocale: "en" | "de") {
    document.cookie = `callassist_ui_locale=${nextLocale};path=/;max-age=31536000;samesite=lax`;
    router.push(switchContentLocale(pathname, nextLocale) ?? pathname.replace(`/${locale}`, `/${nextLocale}`));
  }
  const copy = designMessages[locale];
  const customer = isAuthenticated === true && role !== "content_editor";
  const publicLinks = publicNavigation?.items.filter(({location}) => location === "header") ?? [
    {id: "how-it-works", href: `/${locale}#how-it-works`, label: messages.app.howItWorks},
    {id: "faq", href: contentPath(locale, "faq"), label: messages.app.faq},
    {id: "support", href: contentPath(locale, "support"), label: messages.app.support}
  ];
  const language = <label className="locale-picker"><span className="sr-only">{messages.app.interfaceLanguage}</span>
    <select aria-label={messages.app.interfaceLanguage} value={locale} onChange={event => changeLocale(event.target.value as "en" | "de")}>
      <option value="en">EN</option><option value="de">DE</option>
    </select></label>;
  const primary = customer ? <>
    <Link className="topbar-link" aria-current={pathname.endsWith("/app") ? "page" : undefined} href={localizeHref("/app#new-call")}>{messages.app.newCall}</Link>
    <Link className="topbar-link" aria-current={pathname.includes("/app/calls/") ? "page" : undefined} href={localizeHref("/app#history")}>{messages.app.history}</Link>
    <Link className="topbar-link" aria-current={pathname.endsWith("/account") ? "page" : undefined} href={localizeHref("/app/account")}>{messages.app.account}</Link>
  </> : publicLinks.map(item => <Link className="topbar-link" href={item.href} key={item.id}>{item.label}</Link>);
  const more = <>
    {customer ? <Link href={localizeHref("/redeem")}>{messages.app.redeem}</Link> : null}
    <Link href={localizeHref("/opt-out")}>{messages.app.optOut}</Link>
    {customer ? <><Link href={contentPath(locale, "faq")}>{messages.app.faq}</Link><Link href={contentPath(locale, "support")}>{messages.app.support}</Link></> : null}
    {role && ["content_editor", "admin", "superadmin"].includes(role) ? <Link href="/admin">{messages.app.adminPortal}</Link> : null}
  </>;
  const authLinks = isAuthenticated !== true ? <>
    <Link className="topbar-link" href={localizeHref("/login")}>{messages.app.signIn}</Link>
    <Link className="primary-button compact-button" href={localizeHref("/register")}>{messages.app.createAccount}</Link>
  </> : null;
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">{messages.app.skipToContent}</a>
    <header className="topbar">
      <Brand href={localizeHref("/")} label={messages.app.homeLabel} />
      <nav className="topbar-navigation" aria-label={copy.navigation}>{primary}
        {isAuthenticated === true ? <NavigationMenu label={copy.more} openLabel={copy.openMenu} closeLabel={copy.closeMenu}>{more}</NavigationMenu> : null}
      </nav>
      <div className="topbar-actions">
        <div className="desktop-tools">{authLinks}
          {creditBalance !== null ? <Link className="credit-balance" href={localizeHref("/app/account#usage")}>{messages.app.creditsRemaining(creditBalance)}</Link> : null}
        </div>
        <ThemeToggle lightLabel={messages.app.switchToLightTheme} darkLabel={messages.app.switchToDarkTheme} />
        <div className="desktop-tools">{language}</div>
        <NavigationMenu mobile label={copy.navigation} openLabel={copy.openMenu} closeLabel={copy.closeMenu}>
          {primary}{more}{authLinks}<div className="menu-language">{language}</div>
        </NavigationMenu>
      </div>
    </header>
    {children}
    <SiteFooter locale={locale} navigation={publicNavigation} />
  </div>;
}
'''
p.write_text(s,encoding='utf-8')
print('Shared components and original assets integrated.')
