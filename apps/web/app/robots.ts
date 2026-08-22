import type { MetadataRoute } from "next";
import { absoluteSiteUrl, siteOrigin } from "@/lib/site-config";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{
      userAgent: "*",
      allow: "/",
      disallow: [
        "/en/app/", "/de/app/",
        "/en/admin/", "/de/admin/",
        "/en/login", "/de/login",
        "/en/register", "/de/register",
        "/en/verify", "/de/verify",
        "/en/onboarding", "/de/onboarding",
        "/en/redeem", "/de/redeem"
      ]
    }],
    sitemap: absoluteSiteUrl("/sitemap.xml"),
    host: siteOrigin
  };
}
