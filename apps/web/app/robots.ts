import { uiLocales } from "@callassist/contracts";
import type { MetadataRoute } from "next";
import { absoluteSiteUrl, siteOrigin } from "@/lib/site-config";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", ...uiLocales.flatMap(locale => ["app/", "login", "register", "verify", "onboarding", "redeem"].map(path => `/${locale}/${path}`))]
    }],
    sitemap: absoluteSiteUrl("/sitemap.xml"),
    host: siteOrigin
  };
}
