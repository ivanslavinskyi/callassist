// Check rendered HTML, not just the objects returned by generateMetadata.
// Usage: node scripts/check-public-seo.mjs <server-origin> [canonical-origin]
// Example: node scripts/check-public-seo.mjs http://127.0.0.1:3109 https://shprohli.ch
import assert from "node:assert/strict";

function origin(value) {
  const url = new URL(value);
  assert(["http:", "https:"].includes(url.protocol), "Expected an HTTP(S) origin");
  assert(!url.username && !url.password && !url.search && !url.hash && url.pathname === "/", "Expected a plain origin");
  return url.origin;
}

assert(process.argv[2], "Usage: node scripts/check-public-seo.mjs <server-origin> [canonical-origin]");
const serverOrigin = origin(process.argv[2]);
const canonicalOrigin = origin(process.argv[3] ?? serverOrigin);
const userAgents = [
  ["browser", "Mozilla/5.0"],
  ["Googlebot", "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"],
  ["Twitterbot", "Twitterbot/1.0"]
];

const decode = (value) => value.replace(/&amp;/g, "&");
function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)]
    .map(([, name, value]) => [name.toLowerCase(), decode(value)]));
}
function links(html) {
  return [...html.matchAll(/<(?:xhtml:)?link\b[^>]*>/gi)].map(([tag]) => attributes(tag));
}
async function get(path, userAgent = "public-seo-check") {
  const response = await fetch(new URL(path, serverOrigin), {
    headers: { "user-agent": userAgent }, redirect: "manual", signal: AbortSignal.timeout(30_000)
  });
  assert.equal(response.status, 200, `${path}: expected HTTP 200, received ${response.status}`);
  return response.text();
}

const sitemap = await get("/sitemap.xml");
const entries = [...sitemap.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(([, entry]) => {
  const location = entry.match(/<loc>(.*?)<\/loc>/)?.[1];
  assert(location, "Sitemap entry has no URL");
  const url = new URL(decode(location));
  assert.equal(url.origin, canonicalOrigin, "Unexpected sitemap origin");
  assert(!url.search && !url.hash, "Sitemap canonical must not contain a query or fragment");
  return { url, alternates: links(entry).filter(link => link.rel === "alternate") };
});
assert(entries.length > 0, "Sitemap must contain published pages");
const publishedUrls = new Set(entries.map(({ url }) => url.href));
assert.equal(publishedUrls.size, entries.length, "Duplicate sitemap URLs");

let checks = 0;
const failures = [];
for (const { url, alternates } of entries) {
  for (const [agent, userAgent] of userAgents) {
    try {
      const html = await get(url.pathname, userAgent);
      const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1];
      assert(head, "Missing HTML head");
      const headLinks = links(head);
      assert.deepEqual(headLinks.filter(link => link.rel === "canonical").map(link => link.href), [url.href],
        "Expected exactly one self-canonical in the initial HTML head");
      const body = html.slice(html.toLowerCase().indexOf("</head>") + 7).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
      assert(!links(body).some(link => ["canonical", "alternate"].includes(link.rel)), "SEO links must not stream into the body");
      assert.match(head, /<title>[^<]+<\/title>/i, "Missing head title");
      const robots = [...head.matchAll(/<meta\b[^>]*>/gi)].map(([tag]) => attributes(tag)).find(tag => tag.name === "robots");
      assert(robots && !/noindex/i.test(robots.content), "Published page must be indexable in the initial head");
      assert.equal(attributes(html.match(/<html\b[^>]*>/i)?.[0] ?? "").lang, url.pathname.split("/")[1], "Incorrect document language");
      assert(alternates.length > 0, "Missing sitemap language alternates");
      const headAlternates = headLinks.filter(link => link.rel === "alternate" && link.hreflang);
      assert.equal(headAlternates.length, alternates.length, "HTML and sitemap alternate counts differ");
      for (const alternate of alternates) {
        assert(publishedUrls.has(alternate.href), "Alternate must point to a published canonical URL");
        assert(headAlternates.some(link => link.hreflang === alternate.hreflang && link.href === alternate.href),
          `Missing head alternate: ${alternate.hreflang} ${alternate.href}`);
      }
      checks++;
    } catch (error) {
      failures.push(`${agent} ${url.pathname}: ${error.message.split("\n")[0]}`);
    }
  }
}
console.log(`${checks}/${entries.length * userAgents.length} raw HTML checks passed across ${entries.length} published URLs.`);
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
}
