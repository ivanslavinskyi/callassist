type Environment = Record<string, string | undefined>;

export function buildWebSecurityHeaders(
  environment: Environment = process.env
) {
  const production = environment.NODE_ENV === "production";
  const apiOrigin = urlOrigin(
    environment.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"
  );
  const connectSources = ["'self'", ...(apiOrigin ? [apiOrigin] : [])];
  if (!production) {
    connectSources.push(
      "ws://localhost:*",
      "ws://127.0.0.1:*"
    );
  }
  const scriptSources = ["'self'", "'unsafe-inline'"];
  if (!production) scriptSources.push("'unsafe-eval'");
  const contentSecurityPolicy = [
    "default-src 'self'",
    "base-uri 'self'",
    `connect-src ${connectSources.join(" ")}`,
    "font-src 'self' data:",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "img-src 'self' data: blob:",
    `media-src ${connectSources.join(" ")} blob:`,
    "object-src 'none'",
    `script-src ${scriptSources.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob:"
  ].join("; ");
  const headers = [
    { key: "Content-Security-Policy", value: contentSecurityPolicy },
    {
      key: "Permissions-Policy",
      value: "camera=(), geolocation=(), microphone=(), payment=(), usb=()"
    },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-DNS-Prefetch-Control", value: "off" },
    { key: "X-Download-Options", value: "noopen" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
    { key: "X-XSS-Protection", value: "0" }
  ];
  if (
    production &&
    urlOrigin(environment.NEXT_PUBLIC_SITE_URL ?? "")?.startsWith("https://")
  ) {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=31536000; includeSubDomains"
    });
  }
  return headers;
}

function urlOrigin(value: string) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.origin : null;
  } catch {
    return null;
  }
}
