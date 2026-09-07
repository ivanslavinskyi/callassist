// Never report a green run with skipped database suites or use the app database.
export function requireTestDatabaseUrl() {
  const value = process.env.TEST_DATABASE_URL?.trim();
  if (!value) {
    throw new Error("TEST_DATABASE_URL is required for PostgreSQL integration tests");
  }
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol) ||
    !decodeURIComponent(url.pathname).endsWith("_test")) {
    throw new Error("TEST_DATABASE_URL must reference a dedicated *_test PostgreSQL database");
  }
  return value;
}
