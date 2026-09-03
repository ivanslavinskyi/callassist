import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const textExtensions = new Set([
  ".css", ".js", ".json", ".md", ".mjs", ".sql", ".ts", ".tsx", ".yml", ".yaml"
]);
const ignoredDirectories = new Set([
  ".git", ".next", ".turbo", ".codex-remote-attachments", "coverage", "dist", "node_modules"
]);

async function collectFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(path));
    else if (textExtensions.has(extname(entry.name))) files.push(path);
  }
  return files;
}

const allFiles = [
  ...await collectFiles(join(root, "apps")),
  ...await collectFiles(join(root, "packages")),
  ...await collectFiles(join(root, "docs")),
  join(root, "README.md")
];

const publicCopyFiles = allFiles.filter((file) => {
  const path = relative(root, file).replaceAll("\\", "/");
  if (path.includes(".test.")) return false;
  if (path.startsWith("apps/web/lib/i18n/")) {
    return !path.includes("admin-") && !path.includes("content-admin") && !path.includes("seo-admin");
  }
  return [
    "apps/api/src/content/seed-content.ts",
    "apps/web/app/layout.tsx",
    "apps/web/app/[locale]/opengraph-image.tsx",
    "apps/web/lib/final-transcript-export.ts",
    "apps/web/lib/site-config.ts"
  ].includes(path);
});

const failures = [];
const mojibakePatterns = ["Ã", "Â", "â€", "â€¦", "�"];
for (const file of allFiles) {
  const source = await readFile(file, "utf8");
  for (const pattern of mojibakePatterns) {
    if (source.includes(pattern)) {
      failures.push(`${relative(root, file)} contains mojibake marker ${JSON.stringify(pattern)}`);
    }
  }
}

const runtimeFallbackFiles = new Set([
  "apps/api/src/telephony/twilio-copy.ts",
  "apps/api/src/realtime/openai-realtime-bridge.ts"
]);
const consentPatterns = [
  /\bpress(?:es)? 1\b/iu,
  /\bTaste 1\b/u,
  /die 1 dr(?:ü|ue)cken/iu,
  /die 1 gedr(?:ü|ue)ckt/iu
];
for (const file of allFiles) {
  const path = relative(root, file).replaceAll("\\", "/");
  if (path.includes(".test.") || runtimeFallbackFiles.has(path)) continue;
  const lines = (await readFile(file, "utf8")).split(/\r?\n/u);
  lines.forEach((line, index) => {
    if (consentPatterns.some((pattern) => pattern.test(line))) {
      failures.push(`${path}:${index + 1} presents keypad consent outside the telephony fallback`);
    }
  });
}

const publicBans = [
  ["legacy brand", /\bCallAssist\b/u],
  ["prototype term", /\b(?:compiler|schema|snapshot|policy gate|global safety switch|durable|provider audio)\b/iu],
  ["non-Swiss German spelling", /ß/u]
];
for (const file of publicCopyFiles) {
  const path = relative(root, file).replaceAll("\\", "/");
  const lines = (await readFile(file, "utf8")).split(/\r?\n/u);
  lines.forEach((line, index) => {
    for (const [label, pattern] of publicBans) {
      if (pattern.test(line)) failures.push(`${path}:${index + 1} contains ${label}`);
    }
  });
}

if (failures.length > 0) {
  console.error("Public copy consistency check failed:\n");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(`Public copy consistency check passed (${allFiles.length} files checked).`);
}
