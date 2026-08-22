import type { FastifyInstance } from "fastify";

export const mainApiBodyLimitBytes = 256 * 1_024;
export const webhookBodyLimitBytes = 64 * 1_024;
export const requestTimeoutMs = 30_000;
export const connectionTimeoutMs = 10_000;

const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function registerHttpSecurity(
  app: FastifyInstance,
  options: { allowedOrigins?: string[]; production: boolean }
) {
  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (
      unsafeMethods.has(request.method) &&
      origin !== undefined &&
      options.allowedOrigins !== undefined &&
      !options.allowedOrigins.includes(origin)
    ) {
      return reply.status(403).send({ error: "INVALID_ORIGIN" });
    }
  });

  app.addHook("onSend", async (_request, reply, payload) => {
    reply
      .header("Content-Security-Policy", [
        "default-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'"
      ].join("; "))
      .header("Permissions-Policy", [
        "camera=()",
        "geolocation=()",
        "microphone=()",
        "payment=()",
        "usb=()"
      ].join(", "))
      .header("Referrer-Policy", "no-referrer")
      .header("X-Content-Type-Options", "nosniff")
      .header("X-DNS-Prefetch-Control", "off")
      .header("X-Download-Options", "noopen")
      .header("X-Frame-Options", "DENY")
      .header("X-Permitted-Cross-Domain-Policies", "none");
    if (options.production) {
      reply.header(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains"
      );
    }
    return payload;
  });
}
