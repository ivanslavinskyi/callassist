import { NextRequest, NextResponse } from "next/server";
import { localeFromPathname, localizePathname, negotiateUiLocale, uiLocaleCookie } from "./lib/i18n/routing";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Shared assets and OG resources already carry their own locale/version.
  if (["/brand/", "/og/home/", "/media/og/home/"].some(prefix => pathname.startsWith(prefix))
    || ["/icon.svg", "/apple-icon.png", "/favicon.ico"].includes(pathname)) return NextResponse.next();
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-callassist-ui-locale", "en");
    return NextResponse.next({ request: { headers: requestHeaders } });
  }
  const pathLocale = localeFromPathname(pathname);
  if (!pathLocale) {
    const locale = negotiateUiLocale({
      acceptLanguage: request.headers.get("accept-language"),
      cookieLocale: request.cookies.get(uiLocaleCookie)?.value
    });
    const redirectBase = process.env.NODE_ENV === "production"
      ? process.env.NEXT_PUBLIC_SITE_URL
      : request.nextUrl.href;
    const url = new URL(localizePathname(pathname, locale) + request.nextUrl.search, redirectBase);
    return NextResponse.redirect(url);
  }
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-callassist-ui-locale", pathLocale);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.cookies.set(uiLocaleCookie, pathLocale, {
    maxAge: 60 * 60 * 24 * 365, path: "/", sameSite: "lax"
  });
  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"]
};
