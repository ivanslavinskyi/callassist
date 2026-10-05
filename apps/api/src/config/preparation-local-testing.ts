// Explicit opt-in for a loopback development installation. This capability is
// derived on the server, never from settings, an HTTP header or a request body.
export function preparationLocalTestingEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  if (environment.PREPARATION_LOCAL_TESTING !== "true" || environment.NODE_ENV !== "development") return false;
  if (!["127.0.0.1", "::1"].includes(environment.API_HOST ?? "")) return false;
  try {
    const database = new URL(environment.DATABASE_URL ?? "");
    return ["postgres:", "postgresql:"].includes(database.protocol)
      && ["localhost", "127.0.0.1", "[::1]"].includes(database.hostname);
  } catch { return false; }
}
