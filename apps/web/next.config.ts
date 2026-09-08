import type { NextConfig } from "next";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { buildWebSecurityHeaders } from "./lib/security-headers";

// Next loads package-local files first; injected values retain precedence.
const workspaceEnv = resolve(process.cwd(), "../../.env");
if (existsSync(workspaceEnv)) {
  const values = parseEnv(readFileSync(workspaceEnv, "utf8"));
  for (const name of ["NEXT_PUBLIC_API_URL", "NEXT_PUBLIC_SITE_URL", "INTERNAL_API_URL"]) {
    if (process.env[name] === undefined && values[name] !== undefined) {
      process.env[name] = values[name];
    }
  }
}

const nextConfig: NextConfig = {
  // Parallel local QA must not replace a running dev server's build artifacts.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  transpilePackages: ["@callassist/contracts"],
  async headers() {
    return [{
      source: "/(.*)",
      headers: buildWebSecurityHeaders()
    }];
  }
};

export default nextConfig;
