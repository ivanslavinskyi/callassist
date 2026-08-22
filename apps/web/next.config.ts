import type { NextConfig } from "next";
import { buildWebSecurityHeaders } from "./lib/security-headers";

const nextConfig: NextConfig = {
  transpilePackages: ["@callassist/contracts"],
  async headers() {
    return [{
      source: "/(.*)",
      headers: buildWebSecurityHeaders()
    }];
  }
};

export default nextConfig;
